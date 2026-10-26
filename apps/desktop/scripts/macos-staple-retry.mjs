/**
 * Retry Apple's stapler when a hosted release runner loses its CloudKit connection.
 *
 * Apple's ticket delivery endpoint (api.apple-cloudkit.com) can reset connections from CI runners
 * with NSURLErrorDomain -1005 after notarization already accepted the artifact. Stapling and
 * validation are then safe to repeat; the artifact must never be submitted to the notary service
 * a second time. The budget stays configurable because the outage length belongs to Apple.
 */

import { setTimeout as delay } from 'node:timers/promises'

/** Stapler invocations per artifact, including the first, before the original failure is raised. */
export const DEFAULT_STAPLE_ATTEMPTS = 5
/** Delay before the first retry; each later retry doubles it. */
export const DEFAULT_STAPLE_BACKOFF_MS = 15_000
/** Upper bound for one wait between retries. */
export const MAX_STAPLE_BACKOFF_MS = 120_000

const NETWORK_FAILURE = /(?:CloudKit|NSURLErrorDomain|-1005\b|kCFErrorDomainCFNetwork|internet connection appears to be offline|network connection was lost|connection (?:was )?(?:reset|refused)|timed out)/iu
// CloudKit also answers definitively when no ticket exists; retrying that answer would hide a real release failure.
const MISSING_TICKET = /does not have a ticket stapled|Record not found|CKErrorDomain\s+11\b|NOT_FOUND/iu
const STAPLE_FAILURE = /staple|code:\s*68\b|CloudKit|NSURLErrorDomain|-1005\b/iu

/**
 * Read an optional integer retry setting, rejecting values that would silently change retry semantics.
 * @param {string | undefined} value Raw environment value.
 * @param {number} fallback Value used when the setting is absent or blank.
 * @param {string} name Environment variable name for diagnostics.
 * @param {number} minimum Smallest accepted value.
 * @returns {number} Parsed integer.
 */
function readCount(value, fallback, name, minimum) {
  if (value === undefined || value.trim() === '') return fallback
  const text = value.trim()
  if (!/^\d+$/u.test(text)) {
    throw new Error(`desktop macOS staple: ${name} must be an integer, got ${JSON.stringify(value)}`)
  }
  const count = Number(text)
  if (!Number.isSafeInteger(count) || count < minimum) {
    throw new Error(`desktop macOS staple: ${name} must be at least ${minimum}, got ${JSON.stringify(value)}`)
  }
  return count
}

/**
 * Resolve the stapler retry budget from the packaging environment.
 * @param {NodeJS.ProcessEnv} environment Selected packaging environment.
 * @returns {{ attempts: number, backoffMs: number, maxBackoffMs: number }} Retry budget in milliseconds.
 */
export function resolveStapleRetryPolicy(environment = process.env) {
  return {
    attempts: readCount(environment.DSH_DESKTOP_STAPLE_ATTEMPTS, DEFAULT_STAPLE_ATTEMPTS, 'DSH_DESKTOP_STAPLE_ATTEMPTS', 1),
    backoffMs: readCount(environment.DSH_DESKTOP_STAPLE_BACKOFF_MS, DEFAULT_STAPLE_BACKOFF_MS, 'DSH_DESKTOP_STAPLE_BACKOFF_MS', 0),
    maxBackoffMs: MAX_STAPLE_BACKOFF_MS,
  }
}

/**
 * Delay before one retry: exponential from the configured base and capped so a long outage stays bounded.
 * @param {{ backoffMs: number, maxBackoffMs: number }} policy Retry budget.
 * @param {number} retry One-based retry number.
 * @returns {number} Milliseconds to wait.
 */
export function stapleRetryDelay(policy, retry) {
  return Math.min(policy.backoffMs * 2 ** (retry - 1), policy.maxBackoffMs)
}

/**
 * Collect diagnostic messages across wrapped and nested errors without stack frames.
 * @param {unknown} error Thrown value with an optional cause chain.
 * @returns {string} Messages joined by newlines.
 */
function errorText(error) {
  const messages = []
  const seen = new Set()
  let value = error
  while (value !== undefined && value !== null && !seen.has(value)) {
    seen.add(value)
    messages.push(value instanceof Error ? value.message : String(value))
    value = value instanceof Error ? value.cause : undefined
  }
  return messages.join('\n')
}

/**
 * Whether a stapler failure is a transient Apple/CloudKit transport failure worth retrying.
 * A missing or rejected ticket is a real release failure and must surface on the first attempt.
 * @param {unknown} error Thrown stapler failure.
 * @returns {boolean} True for recognizable network and CloudKit transport failures.
 */
export function isStapleNetworkFailure(error) {
  const text = errorText(error)
  return !MISSING_TICKET.test(text) && NETWORK_FAILURE.test(text)
}

/**
 * Whether electron-notarize failed while stapling rather than while checking, submitting, or waiting.
 * @param {unknown} error Failure from the notarization call.
 * @returns {boolean} True when stapling can be retried without resubmitting the artifact.
 */
export function isStapleFailure(error) {
  return STAPLE_FAILURE.test(errorText(error))
}

/**
 * Block the calling thread between verification attempts; packaging owns no concurrent work on it.
 * @param {number} milliseconds Wait duration.
 * @returns {void}
 */
export function sleepSynchronously(milliseconds) {
  if (milliseconds <= 0) return
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds)
}

/**
 * Report one retryable failure without dumping tool output or credentials.
 * @param {number} attempt Failed attempt number.
 * @param {{ attempts: number }} policy Retry budget.
 * @param {unknown} error Failure.
 * @param {string} label Stable operation name.
 * @param {number} milliseconds Delay before the next attempt.
 * @returns {void}
 */
function reportRetry(attempt, policy, error, label, milliseconds) {
  const reason = errorText(error).split('\n', 1)[0] ?? ''
  process.stderr.write(`desktop macOS staple: ${label} attempt ${attempt}/${policy.attempts} failed (${reason}); retrying in ${(milliseconds / 1000).toFixed(0)}s\n`)
}

/**
 * Preserve the original stapler failure while naming the exhausted attempt count.
 * @param {unknown} error Last failure.
 * @param {number} attempts Attempts performed.
 * @param {string} label Stable operation name.
 * @returns {Error} Failure whose cause is the original error.
 */
function stapleRetryExhausted(error, attempts, label) {
  const reason = errorText(error).split('\n', 1)[0] ?? ''
  return new Error(`desktop macOS staple: ${label} still failed after ${attempts} attempts: ${reason}`, { cause: error })
}

/**
 * Run one synchronous stapler operation, retrying transient CloudKit transport failures with backoff.
 * @template T
 * @param {() => T} operation Stapler invocation.
 * @param {{ policy?: { attempts: number, backoffMs: number, maxBackoffMs: number }, environment?: NodeJS.ProcessEnv, retryOn?: (error: unknown) => boolean, sleep?: (milliseconds: number) => void, label?: string }} options Retry overrides.
 * @returns {T} Operation result.
 */
export function retryStapleOperation(operation, options = {}) {
  const policy = options.policy ?? resolveStapleRetryPolicy(options.environment)
  const retryOn = options.retryOn ?? isStapleNetworkFailure
  const sleep = options.sleep ?? sleepSynchronously
  const label = options.label ?? 'stapler'
  for (let attempt = 1; ; attempt += 1) {
    if (attempt > 1) sleep(stapleRetryDelay(policy, attempt - 1))
    try {
      return operation()
    } catch (error) {
      if (!retryOn(error)) throw error
      if (attempt >= policy.attempts) throw stapleRetryExhausted(error, attempt, label)
      reportRetry(attempt, policy, error, label, stapleRetryDelay(policy, attempt))
    }
  }
}

/**
 * Run one asynchronous stapler operation, retrying transient CloudKit transport failures with backoff.
 * @template T
 * @param {() => Promise<T> | T} operation Stapler invocation.
 * @param {{ policy?: { attempts: number, backoffMs: number, maxBackoffMs: number }, environment?: NodeJS.ProcessEnv, retryOn?: (error: unknown) => boolean, sleep?: (milliseconds: number) => Promise<void> | void, label?: string }} options Retry overrides.
 * @returns {Promise<T>} Operation result.
 */
export async function retryStapleOperationAsync(operation, options = {}) {
  const policy = options.policy ?? resolveStapleRetryPolicy(options.environment)
  const retryOn = options.retryOn ?? isStapleNetworkFailure
  const sleep = options.sleep ?? delay
  const label = options.label ?? 'stapler'
  for (let attempt = 1; ; attempt += 1) {
    if (attempt > 1) await sleep(stapleRetryDelay(policy, attempt - 1))
    try {
      return await operation()
    } catch (error) {
      if (!retryOn(error)) throw error
      if (attempt >= policy.attempts) throw stapleRetryExhausted(error, attempt, label)
      reportRetry(attempt, policy, error, label, stapleRetryDelay(policy, attempt))
    }
  }
}
