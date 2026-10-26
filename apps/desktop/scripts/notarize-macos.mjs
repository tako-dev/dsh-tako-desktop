/** Preserve electron-notarize's signature checks and stapling while recording separate Apple phases. */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { notarize } from '@electron/notarize'
import { packagingStep } from './packaging-step.mjs'
import {
  isStapleFailure,
  resolveStapleRetryPolicy,
  retryStapleOperationAsync,
} from './macos-staple-retry.mjs'

/**
 * Staple one accepted App directory or disk image with Apple's stapler.
 * @param {string} appPath Packaged `.app` directory or `.dmg` file.
 * @returns {Promise<void>} Resolves after the ticket is attached.
 */
function runStapler(appPath) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('/usr/bin/xcrun', ['stapler', 'staple', appPath], { stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    let spawnError
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => { output += chunk })
    child.stderr.on('data', chunk => { output += chunk })
    child.once('error', error => { spawnError = error })
    child.once('close', (code, signal) => {
      if (spawnError !== undefined) {
        reject(new Error(`desktop macOS staple: could not execute xcrun stapler staple: ${spawnError.message}`))
        return
      }
      if (signal !== null) {
        reject(new Error(`desktop macOS staple: xcrun stapler staple was terminated by ${signal}`))
        return
      }
      if (code !== 0) {
        const diagnostic = output.trim()
        reject(new Error(`desktop macOS staple: xcrun stapler staple exited with ${String(code)}${diagnostic === '' ? '' : `: ${diagnostic}`}`))
        return
      }
      resolvePromise()
    })
  })
}

/**
 * Retry stapling an artifact whose notarization was already accepted, without resubmitting it.
 * @param {string} appPath Packaged `.app` directory or `.dmg` file.
 * @param {{ policy?: object, environment?: NodeJS.ProcessEnv, execute?: (appPath: string) => Promise<void>, sleep?: (milliseconds: number) => Promise<void> | void }} options Retry overrides.
 * @returns {Promise<void>} Resolves after one stapler attempt succeeds.
 */
export async function stapleMacOSArtifact(appPath, options = {}) {
  const execute = options.execute ?? runStapler
  await retryStapleOperationAsync(() => execute(appPath), {
    policy: options.policy ?? resolveStapleRetryPolicy(options.environment),
    retryOn: isStapleFailure,
    sleep: options.sleep,
    label: 'xcrun stapler staple',
  })
}

/**
 * Notarize and staple one App or DMG through the measured notarytool adapter.
 * @param {object} options Validated credentials and appPath accepted by electron-notarize.
 * @param {{ environment?: NodeJS.ProcessEnv, submit?: (options: object) => Promise<void>, staple?: (appPath: string, options: object) => Promise<void> }} dependencies Injectable Apple operations for tests.
 * @returns {Promise<void>} Resolves only after Apple acceptance and stapling.
 */
export async function notarizeMacOS(options, dependencies = {}) {
  const environment = dependencies.environment ?? process.env
  const submit = dependencies.submit ?? notarize
  const staple = dependencies.staple ?? stapleMacOSArtifact
  const policy = resolveStapleRetryPolicy(environment)
  const secrets = Object.entries(options).filter(([name]) => /password|key|appleId/iu.test(name)).map(([, value]) => String(value))
  await packagingStep(environment.DSH_DESKTOP_PACKAGING_RUN_DIR, 'notarize-and-staple', async () => {
    try {
      await submit({ ...options, notarytoolPath: fileURLToPath(new URL('./logged-notarytool.mjs', import.meta.url)) })
    } catch (error) {
      // Apple already accepted this artifact; only ticket delivery failed, so staple it again
      // instead of submitting a second notarization request.
      if (!isStapleFailure(error)) throw error
      process.stderr.write(`desktop macOS notarization: Apple accepted ${options.appPath} but stapling failed; retrying the ticket without resubmitting\n`)
      await staple(options.appPath, { policy, environment })
      process.stdout.write(`desktop macOS notarization: stapled ${options.appPath} without a second notarization submission\n`)
    }
  }, secrets)
}
