/** Automated native welcome acceptance; real Electron/renderer/IPC, loopback test login only. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { cp, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const repository = fileURLToPath(new URL('../../..', import.meta.url))
const appRoot = join(repository, 'apps/desktop')
const requireWeb = createRequire(join(repository, 'apps/web/package.json'))
const { _electron } = requireWeb('playwright')
const requireApp = createRequire(join(appRoot, 'package.json'))
const electronPackage = resolve(requireApp.resolve('electron/package.json'), '..')
const pathFile = join(electronPackage, 'path.txt')
if (!existsSync(pathFile)) throw new Error('Pinned Electron is not installed; run node apps/desktop/node_modules/electron/install.js with a local ELECTRON_CACHE')
const executablePath = join(electronPackage, 'dist', (await readFile(pathFile, 'utf8')).trim())
const evidenceBase = join(repository, '.playwright-mcp')
await mkdir(evidenceBase, { recursive: true })
const root = await mkdtemp(join(evidenceBase, 'tako-login-ui-'))
const application = join(root, 'app')
await mkdir(join(application, 'lib'), { recursive: true })
await mkdir(join(root, 'home'), { recursive: true })
await writeFile(join(application, 'package.json'), JSON.stringify({ name: 'tako-login-ui-test', type: 'module', version: '0.0.0' }))
await cp(join(appRoot, 'renderer'), join(application, 'renderer'), { recursive: true })
await cp(join(appRoot, 'lib/welcome'), join(application, 'lib/welcome'), { recursive: true })
await cp(join(appRoot, 'lib/preload-welcome.cjs'), join(application, 'lib/preload-welcome.cjs'))
for (const name of ['welcome-window', 'welcome-api', 'locale', 'tako-login', 'welcome-backend', 'account-backend']) {
  await cp(join(appRoot, 'lib/types', `${name}.js`), join(application, 'lib', `${name}.js`))
}
await symlink(join(appRoot, 'node_modules'), join(application, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
  !/KEY|SECRET|TOKEN|PASSWORD|^NODE_OPTIONS$|^ELECTRON_RUN_AS_NODE$|^(HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY)$|^(DSH_|TAKO_|ANTHROPIC_|OPENAI_|DEEPSEEK_)/iu.test(name)))
Object.assign(env, { HOME: join(root, 'home'), USERPROFILE: join(root, 'home'), DSH_HOME: join(root, 'home/dsh'),
  DSH_AGENTS_HOME: join(root, 'home/agents'), DSH_LOGIN_UI_ROOT: root, DSH_TELEMETRY_DISABLED: '1',
  XDG_CONFIG_HOME: join(root, 'home/config'), XDG_CACHE_HOME: join(root, 'home/cache'),
  TEMP: root, TMP: root, TMPDIR: root })
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim()
const checks = []
let electronApp
const report = { commit, realElectron: true, liveAccount: false, modelCalls: 0,
  surface: 'built native welcome window, preload, renderer, RPC and callback; not a full packaged-app installation', checks }
async function capture(page, name) {
  // This label is evidence metadata, not simulated product behavior.
  await page.evaluate(() => {
    let label = document.getElementById('acceptance-test-label')
    if (!label) {
      label = document.createElement('aside')
      label.id = 'acceptance-test-label'
      label.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:999999;background:#7a1f1f;color:white;font:11px system-ui;padding:5px;text-align:center;pointer-events:none'
      label.textContent = 'AUTOMATED UI ACCEPTANCE · TEST PROVIDER · NO LIVE ACCOUNT'
      document.body.append(label)
    }
  })
  await page.screenshot({ path: join(root, name), scale: 'css' })
}
try {
  electronApp = await _electron.launch({ executablePath,
    args: [join(appRoot, 'tests/fixtures/tako-login-ui.mjs')], cwd: repository, env, timeout: 60000 })
  const page = await electronApp.firstWindow()
  await page.locator('#sign-in').waitFor({ state: 'visible' })
  assert.match(await page.locator('#sign-in').innerText(), /Tako/)
  assert.equal(await page.locator('#sign-in').innerText(), '通过浏览器登录 Tako')
  const initial = await electronApp.evaluate(() => globalThis.loginUiAcceptance.snapshot())
  assert.deepEqual(initial.preferences, { sandbox: true, contextIsolation: true, nodeIntegration: false })
  checks.push('pending catalog keeps Tako entry; native sandbox and context isolation retained')
  await capture(page, '00-tako-entry.png')
  await page.locator('#api-key').click()
  await page.locator('#key-input').fill('fixture-unbound-key')
  await page.locator('#save-key').click()
  await page.locator('#key-error').waitFor({ state: 'visible' })
  assert.equal((await electronApp.evaluate(() => globalThis.loginUiAcceptance.snapshot())).saved, 0)
  checks.push('missing credential metadata refuses writes instead of using official account')
  await capture(page, '01-unbound-save-rejected.png')
  await page.locator('#back-to-login').click()
  await page.locator('#sign-in').click()
  await page.locator('#cancel-tako-login').waitFor({ state: 'visible' })
  await capture(page, '02-login-pending.png')
  await page.locator('#cancel-tako-login').click()
  await page.locator('#sign-in').waitFor({ state: 'visible' })
  await page.waitForFunction(() => document.querySelector('#sign-in')?.disabled === false)
  checks.push('native sign-in click opens an isolated browser and supports cancellation')
  await electronApp.evaluate(() => globalThis.loginUiAcceptance.ready())
  const browserOpened = electronApp.waitForEvent('window', { timeout: 30000 })
  await page.locator('#sign-in').click()
  await page.locator('#cancel-tako-login').waitFor({ state: 'visible' })
  const browser = await browserOpened
  await browser.waitForURL('**/app/authorize?**', { timeout: 30000 })
  await browser.getByRole('link', { name: '确认测试授权', exact: true }).click()
  await browser.getByText('Tako 登录成功，请返回 DSH Tako 窗口。', { exact: true }).waitFor()
  await capture(browser, '03-chinese-callback.png')
  await page.waitForFunction(() => document.querySelector('#sign-in')?.disabled === false)
  const completed = await electronApp.evaluate(() => globalThis.loginUiAcceptance.snapshot())
  assert.equal(completed.saved, 1)
  assert.equal(completed.savedRef, 'TAKO_API_KEY')
  assert.equal(completed.officialStarts, 0)
  assert.equal(completed.opened, 2)
  assert.equal(completed.cancelled, 1)
  checks.push('real loopback callback is Chinese; confirmed key writes only to Tako reference')
  checks.push('official sign-in path never ran')
  report.status = 'passed'
} catch (error) {
  report.status = 'failed'
  report.error = error instanceof Error ? error.message : String(error)
  process.exitCode = 1
} finally {
  if (electronApp) await electronApp.close()
  await writeFile(join(root, 'result.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ evidence: root, ...report }, null, 2))
}
