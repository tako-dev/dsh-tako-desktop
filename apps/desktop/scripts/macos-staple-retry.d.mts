/** Retry Apple's stapler when a hosted release runner loses its CloudKit connection. */

/** Stapler invocations per artifact, including the first, before the original failure is raised. */
export const DEFAULT_STAPLE_ATTEMPTS: number
/** Delay before the first retry; each later retry doubles it. */
export const DEFAULT_STAPLE_BACKOFF_MS: number
/** Upper bound for one wait between retries. */
export const MAX_STAPLE_BACKOFF_MS: number

/** Retry budget for one stapler operation. */
export interface StapleRetryPolicy {
  readonly attempts: number
  readonly backoffMs: number
  readonly maxBackoffMs: number
}

/** Overrides for one retried stapler operation. */
export interface StapleRetryOptions {
  readonly policy?: StapleRetryPolicy
  readonly environment?: NodeJS.ProcessEnv
  readonly retryOn?: (error: unknown) => boolean
  readonly sleep?: (milliseconds: number) => void
  readonly label?: string
}

/** Overrides for one asynchronously retried stapler operation. */
export interface AsyncStapleRetryOptions extends Omit<StapleRetryOptions, 'sleep'> {
  readonly sleep?: (milliseconds: number) => Promise<void> | void
}

/**
 * Resolve the stapler retry budget from the packaging environment.
 * @param environment - Selected packaging environment.
 * @returns Retry budget in milliseconds.
 */
export function resolveStapleRetryPolicy(environment?: NodeJS.ProcessEnv): StapleRetryPolicy

/**
 * Delay before one retry: exponential from the configured base and capped.
 * @param policy - Retry budget.
 * @param retry - One-based retry number.
 * @returns Milliseconds to wait.
 */
export function stapleRetryDelay(policy: Pick<StapleRetryPolicy, 'backoffMs' | 'maxBackoffMs'>, retry: number): number

/**
 * Whether a stapler failure is a transient Apple/CloudKit transport failure worth retrying.
 * @param error - Thrown stapler failure.
 * @returns True for recognizable network and CloudKit transport failures.
 */
export function isStapleNetworkFailure(error: unknown): boolean

/**
 * Whether electron-notarize failed while stapling rather than while submitting or waiting.
 * @param error - Failure from the notarization call.
 * @returns True when stapling can be retried without resubmitting the artifact.
 */
export function isStapleFailure(error: unknown): boolean

/**
 * Block the calling thread between verification attempts.
 * @param milliseconds - Wait duration.
 */
export function sleepSynchronously(milliseconds: number): void

/**
 * Run one synchronous stapler operation, retrying transient CloudKit transport failures with backoff.
 * @param operation - Stapler invocation.
 * @param options - Retry overrides.
 * @returns Operation result.
 */
export function retryStapleOperation<T>(operation: () => T, options?: StapleRetryOptions): T

/**
 * Run one asynchronous stapler operation, retrying transient CloudKit transport failures with backoff.
 * @param operation - Stapler invocation.
 * @param options - Retry overrides.
 * @returns Operation result.
 */
export function retryStapleOperationAsync<T>(
  operation: () => Promise<T> | T,
  options?: AsyncStapleRetryOptions,
): Promise<T>
