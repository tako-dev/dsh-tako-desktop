/** Replaces only Playwright in an isolated helper process; no Electron executable or installer runs. */
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdirSync, writeFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'

const [, , executable, version, home, userData, output, , scenario] = process.argv
const requireParent = new URL('../../../web/package.json', import.meta.url).href
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL === requireParent) {
    if (specifier === 'playwright/package.json') return { url: new URL('../../../web/package.json', import.meta.url).href, shortCircuit: true }
    if (specifier === 'playwright') {
      if (scenario === 'import-failure') throw new Error('Controlled Playwright import failure')
      return { url: import.meta.url, shortCircuit: true }
    }
  }
  return next(specifier, context)
} })
process.once('exit', () => { hooks.deregister() })

/** Supplies controlled application observations to the helper's subprocess regressions. */
export const _electron = { async launch(options) {
  assert.equal(options.executablePath, executable)
  assert.deepEqual(options.args, [`--user-data-dir=${userData}`])
  assert.equal(options.cwd, home)
  assert.equal(options.env.HOME, home)
  assert.equal(options.env.USERPROFILE, home)
  assert.equal(options.env.DSH_HOME, home)
  assert.equal(options.env.DSH_TELEMETRY_DISABLED, '1')
  assert.equal(options.env.RELEASE_SMOKE_SENTINEL_TOKEN, undefined)
  assert.equal(options.env.TAKO_PRIVATE_SETTING, undefined)
  assert.equal(options.env.NODE_OPTIONS, undefined)
  assert.equal(options.env.ELECTRON_RUN_AS_NODE, undefined)
  assert.ok(options.timeout > 0)
  if (scenario === 'launch-failure') throw new Error('Controlled launch failure')
  if (scenario === 'uncaught-exception' || scenario === 'unhandled-rejection') {
    setImmediate(() => {
      const error = new Error(`Controlled ${scenario}`)
      if (scenario === 'uncaught-exception') throw error
      void Promise.reject(error)
    })
    return new Promise(() => {})
  }
  if (scenario === 'direct-exit') process.exit(1)

  const logs = join(userData, 'logs')
  mkdirSync(logs, { recursive: true })
  if (scenario === 'crash-report') writeFileSync(join(logs, 'crash-test-main.log'), 'retained crash contents\n')
  if (scenario === 'crash-copy-failure') mkdirSync(join(logs, 'crash-test-main.log'))
  if (scenario === 'startup-diagnostic') writeFileSync(options.env.DSH_DESKTOP_DIAGNOSTIC_FILE, 'controlled startup failure\n')
  const child = Object.assign(new EventEmitter(), { pid: process.pid, exitCode: null, signalCode: null,
    stdout: new PassThrough(), stderr: new PassThrough() })
  const application = new EventEmitter()
  const terminate = (code, signal = null) => {
    child.exitCode = code
    child.signalCode = signal
    child.stdout.end('controlled application stdout\n')
    child.stderr.end('controlled application stderr\n')
    child.emit('exit', code, signal)
    application.emit('close')
  }
  let form = false
  let signInWaits = 0
  const hidden = Object.assign(new EventEmitter(), { url: () => 'file:///installed/workspace.html', locator: () => {
    throw new Error('Hidden workspace is not welcome readiness')
  } })
  const welcome = Object.assign(new EventEmitter(), {
    url: () => 'file:///installed/welcome.html',
    locator: selector => ({
      async waitFor({ state, timeout }) {
        assert.equal(state, 'visible')
        assert.ok(timeout > 0)
        assert.ok(form ? ['#key-input', '#back-to-login'].includes(selector) : ['#api-key', '#sign-in'].includes(selector))
        if (selector === '#sign-in' && ++signInWaits === 2 && scenario === 'early-exit') terminate(7)
      },
      async innerText() { assert.equal(selector, '#sign-in'); return 'Sign in to Tako' },
      async click() {
        assert.equal(selector, form ? '#back-to-login' : '#api-key')
        form = !form
      },
    }),
    async screenshot({ path }) { writeFileSync(path, 'controlled screenshot\n') },
  })
  Object.assign(application, {
    process: () => child,
    async evaluate() {
      if (scenario === 'already-exited') throw new Error('Controlled application already exited')
      return { pid: process.pid + 1, version: scenario === 'wrong-version' ? '99.0.0' : version,
        packaged: true, executable, userData, logs, home }
    },
    windows: () => scenario === 'missing-welcome' ? [hidden] : [hidden, welcome],
    async close() {
      assert.equal(application.listenerCount('window'), 0)
      assert.equal(application.listenerCount('close'), 0)
      assert.equal(hidden.listenerCount('domcontentloaded'), 0)
      assert.equal(welcome.listenerCount('domcontentloaded'), 0)
      if (child.exitCode !== null || child.signalCode !== null) return
      setImmediate(() => terminate(scenario === 'nonzero-exit' ? 7 : scenario === 'signal-exit' ? null : 0,
        scenario === 'signal-exit' ? 'SIGSEGV' : null))
    },
  })
  if (scenario === 'already-exited') terminate(7)
  return application
} }
