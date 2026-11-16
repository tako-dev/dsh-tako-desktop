/** Verifies the installed Host and welcome renderer without credentials or substituted application code. */
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const [executable, version, home, userData, output, seconds] = process.argv.slice(2)
assert.ok(executable && version && home && userData && output && seconds, 'Expected executable, version, home, userData, output and startup seconds')
const repository = fileURLToPath(new URL('../../..', import.meta.url))
const requireWeb = createRequire(join(repository, 'apps/web/package.json'))
const { _electron } = requireWeb('playwright')
const timeout = Number(seconds) * 1000
const deadline = Date.now() + timeout
const remaining = () => Math.max(1, deadline - Date.now())
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
  !/KEY|SECRET|TOKEN|PASSWORD|^NODE_OPTIONS$|^ELECTRON_RUN_AS_NODE$|^(DSH_|TAKO_|ANTHROPIC_|OPENAI_|DEEPSEEK_)/iu.test(name)))
const temporary = join(home, 'temp')
await mkdir(temporary, { recursive: true })
await mkdir(userData, { recursive: true })
Object.assign(env, { HOME: home, USERPROFILE: home, DSH_HOME: home, DSH_AGENTS_HOME: join(home, 'agents'),
  DSH_TELEMETRY_DISABLED: '1', TEMP: temporary, TMP: temporary, TMPDIR: temporary,
  DSH_DESKTOP_DIAGNOSTIC_FILE: join(output, 'main-startup.log') })
const report = { status: 'failed', version, checks: [] }
let application
let launchedProcess
let exited
let stderr = ''
let stdout = ''
try {
  application = await _electron.launch({ executablePath: executable, args: [`--user-data-dir=${userData}`],
    cwd: home, env, timeout: remaining(), artifactsDir: output })
  launchedProcess = application.process()
  report.launchedProcess = { pid: launchedProcess.pid, exitCode: null, signal: null, exited: false }
  exited = new Promise(resolveExit => {
    const record = (exitCode, signal) => {
      Object.assign(report.launchedProcess, { exitCode, signal, exited: true })
      resolveExit()
    }
    if (launchedProcess.exitCode !== null || launchedProcess.signalCode !== null) record(launchedProcess.exitCode, launchedProcess.signalCode)
    else launchedProcess.once('exit', record)
  })
  launchedProcess.stdout?.on('data', chunk => { stdout = (stdout + chunk).slice(-65536) })
  launchedProcess.stderr?.on('data', chunk => { stderr = (stderr + chunk).slice(-65536) })
  report.application = await application.evaluate(({ app }) => ({ pid: process.pid, version: app.getVersion(),
    packaged: app.isPackaged, executable: app.getPath('exe'), userData: app.getPath('userData'), logs: app.getPath('logs'), home: process.env.DSH_HOME }))
  assert.equal(report.application.packaged, true)
  assert.equal(report.application.version, version)
  assert.equal(resolve(report.application.executable).toLowerCase(), resolve(executable).toLowerCase())
  assert.equal(resolve(report.application.userData).toLowerCase(), resolve(userData).toLowerCase())
  assert.equal(report.application.home, home)
  report.checks.push('installed-executable-and-private-state')

  // The hidden workspace is created before the welcome window; neither its existence nor process survival is readiness.
  const page = await new Promise((resolvePage, reject) => {
    const disposers = []
    const finish = (page, error) => {
      clearTimeout(timer)
      for (const dispose of disposers) dispose()
      if (error) reject(error)
      else resolvePage(page)
    }
    const inspect = page => {
      const check = () => { if (new URL(page.url()).pathname.endsWith('/welcome.html')) finish(page) }
      page.on('domcontentloaded', check)
      disposers.push(() => page.off('domcontentloaded', check))
      check()
    }
    const closed = () => { finish(undefined, new Error('Installed application exited before welcome readiness')) }
    const timer = setTimeout(() => { finish(undefined, new Error('Installed Host did not open its welcome renderer before the startup deadline')) }, remaining())
    application.on('window', inspect)
    application.on('close', closed)
    disposers.push(() => application.off('window', inspect), () => application.off('close', closed))
    for (const window of application.windows()) inspect(window)
  })
  await page.locator('#api-key').waitFor({ state: 'visible', timeout: remaining() })
  await page.locator('#sign-in').waitFor({ state: 'visible', timeout: remaining() })
  assert.match(await page.locator('#sign-in').innerText({ timeout: remaining() }), /Tako/u)
  await page.screenshot({ path: join(output, 'welcome.png'), timeout: remaining() })
  await page.locator('#api-key').click({ timeout: remaining() })
  await page.locator('#key-input').waitFor({ state: 'visible', timeout: remaining() })
  await page.screenshot({ path: join(output, 'api-key.png'), timeout: remaining() })
  await page.locator('#back-to-login').click({ timeout: remaining() })
  await page.locator('#sign-in').waitFor({ state: 'visible', timeout: remaining() })
  assert.equal(existsSync(env.DSH_DESKTOP_DIAGNOSTIC_FILE), false)
  report.checks.push('host-ready-and-welcome-interactive-without-login')
  report.status = 'passed'
} catch (error) {
  report.error = error instanceof Error ? error.stack : String(error)
  process.exitCode = 1
} finally {
  if (application) {
    let timer
    try {
      assert.equal(report.launchedProcess.exited, false, 'Installed application exited before normal shutdown was requested')
      await Promise.race([Promise.all([application.close(), exited]), new Promise((_, reject) => {
        timer = setTimeout(() => { reject(new Error('Installed application did not shut down within 60 s')) }, 60000)
      })])
      assert.equal(report.launchedProcess.signal, null, 'Installed application shutdown was interrupted by a signal')
      assert.equal(report.launchedProcess.exitCode, 0, 'Installed application exited unsuccessfully')
      report.checks.push('normal-application-shutdown')
    } catch (error) {
      report.status = 'failed'
      report.shutdownError = error instanceof Error ? error.message : String(error)
      process.exitCode = 1
    } finally { clearTimeout(timer) }
  }
  try {
    if (report.application && existsSync(report.application.logs)) {
      const crashes = (await readdir(report.application.logs)).filter(name => name.startsWith('crash-') && name.endsWith('.log'))
      report.crashes = crashes
      if (crashes.length > 0) {
        report.status = 'failed'
        process.exitCode = 1
        const crashOutput = join(output, 'crashes')
        await mkdir(crashOutput, { recursive: true })
        for (const name of crashes) await copyFile(join(report.application.logs, name), join(crashOutput, name))
      }
    }
  } catch (error) {
    report.status = 'failed'
    report.diagnosticsError = error instanceof Error ? error.message : String(error)
    process.exitCode = 1
  }
  try {
    await writeFile(join(output, 'application.stdout.log'), stdout)
    await writeFile(join(output, 'application.stderr.log'), stderr)
  } catch (error) {
    report.status = 'failed'
    report.outputError = error instanceof Error ? error.message : String(error)
    process.exitCode = 1
  }
  try { await writeFile(join(output, 'application.json'), JSON.stringify(report, null, 2) + '\n') }
  catch (error) {
    report.status = 'failed'
    report.reportError = error instanceof Error ? error.message : String(error)
    process.exitCode = 1
  }
  console.log(JSON.stringify(report, null, 2))
}
// PowerShell owns forced process cleanup and uninstall if startup or normal shutdown failed.
if (process.exitCode) process.exit(1)
