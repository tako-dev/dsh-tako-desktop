/** Real sandboxed Electron welcome window and IPC with an isolated loopback test provider. */
import { app, BrowserWindow } from 'electron'
import { createServer } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

async function main() {
const root = process.env.DSH_LOGIN_UI_ROOT
if (!root) throw new Error('login UI acceptance requires its own scratch root')
app.setAppPath(join(root, 'app'))
app.setPath('userData', join(root, 'electron'))
app.setPath('sessionData', join(root, 'electron'))
const fixture = { routeReady: false, saved: 0, savedRef: undefined, officialStarts: 0, opened: 0, cancelled: 0 }
let login
let browser
let welcome
let origin
const key = 'fixture-ui-key-not-a-real-credential'
const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1')
  response.setHeader('cache-control', 'no-store')
  if (url.pathname === '/app/authorize') {
    const callback = new URL(url.searchParams.get('redirect_uri'))
    callback.searchParams.set('state', url.searchParams.get('state'))
    callback.searchParams.set('code', 'fixture-code')
    response.setHeader('content-type', 'text/html; charset=utf-8')
    const href = callback.href.replaceAll('&', '&amp;').replaceAll('"', '&quot;')
    response.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>TEST provider</title>
      <style>body{font:18px system-ui;padding:32px}a{display:block;padding:16px}</style>
      <h1>自动化 UI 验收 · 测试授权服务</h1><p>不使用真实账号，不执行付费模型请求。</p>
      <a href="${href}">确认测试授权</a></html>`)
    return
  }
  let value
  if (url.pathname === '/api/desktop/token') {
    let body = ''
    for await (const chunk of request) body += chunk
    const input = JSON.parse(body)
    if (input.code !== 'fixture-code' || !input.code_verifier || input.client_id !== 'tako-connect') {
      response.writeHead(400).end()
      return
    }
    value = { key }
  } else if (url.pathname === '/v1/models') {
    if (request.headers.authorization !== `Bearer ${key}`) { response.writeHead(401).end(); return }
    value = { data: [] }
  } else if (url.pathname.startsWith('/api/')) {
    let body = ''
    for await (const chunk of request) body += chunk
    const input = JSON.parse(body)
    let result
    if (input.method === 'settings/describe') {
      result = { namespaces: [
        { ns: 'locale', value: { preference: 'zh' } },
        { ns: 'llm-deepseek', value: { apiKeyEnv: 'OFFICIAL_FIXTURE_REF' } },
        ...(fixture.routeReady ? [{ ns: 'tako', value: { apiKeyEnv: 'TAKO_API_KEY', baseURL: origin } }] : []),
      ] }
    } else if (input.method === 'llm/listConfigurableProviders') result = []
    else if (input.method === 'credentials/describe') {
      result = Object.fromEntries(input.payload.args.refs.map(ref => [ref, { configured: fixture.saved > 0, writable: true }]))
    } else if (input.method === 'credentials/set') {
      if (input.payload.args.ref !== 'TAKO_API_KEY') throw new Error('wrong credential target')
      fixture.saved++
      fixture.savedRef = input.payload.args.ref
    } else throw new Error('unexpected fixture RPC')
    value = { type: 'server-response', rpcId: input.rpcId, result: { ok: true, value: result } }
  } else { response.setHeader('content-type', 'text/plain'); response.end('fixture host'); return }
  response.setHeader('content-type', 'application/json')
  response.end(JSON.stringify(value))
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
origin = `http://127.0.0.1:${server.address().port}`
const { connectDesktopWelcome } = await import(pathToFileURL(join(root, 'app/lib/welcome-backend.js')).href)
const { openWelcomeWindow } = await import(pathToFileURL(join(root, 'app/lib/welcome-window.js')).href)
const { resolveDesktopLocale } = await import(pathToFileURL(join(root, 'app/lib/locale.js')).href)
const { startTakoBrowserLogin } = await import(pathToFileURL(join(root, 'app/lib/tako-login.js')).href)
console.log('LOGIN_UI: mock server ready')
await app.whenReady()
console.log('LOGIN_UI: Electron ready')
const backend = await connectDesktopWelcome(origin, fetch, undefined, fetch, 'tako')
console.log('LOGIN_UI: authenticated fixture Host')
await backend.read()
console.log('LOGIN_UI: welcome metadata read')
welcome = await openWelcomeWindow(resolveDesktopLocale('zh-CN'), {
  provider: backend.provider, analyticsEnabled: async () => false, takeNotice: async () => undefined,
  startSignIn: async () => { fixture.officialStarts++; throw new Error('official sign-in must not run') },
  cancelSignIn: async () => { throw new Error('official cancel must not run') },
  copySignInLink: async () => { throw new Error('official copy must not run') },
  saveApiKey: value => backend.save(value), skip: async () => {},
  openProviderSite: async () => {
    login = await startTakoBrowserLogin({ websiteOrigin: origin, locale: 'zh-CN' })
    browser = new BrowserWindow({ width: 600, height: 700, useContentSize: true, title: 'TEST login provider',
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } })
    fixture.opened++
    await browser.loadURL(login.authorizeUrl)
    const result = await login.wait
    if (!result.ok) return result
    const saved = await backend.save(result.apiKey)
    return saved.ok ? { ok: true } : { ok: false, reason: 'failed' }
  },
  cancelProviderLogin: async () => { fixture.cancelled++; login?.cancel(); browser?.destroy() },
})
// Test-only main-process control; never exposed through the renderer preload.
globalThis.loginUiAcceptance = {
  ready: () => { fixture.routeReady = true },
  snapshot: () => ({ ...fixture, provider: backend.provider,
    preferences: { sandbox: welcome.webContents.getLastWebPreferences().sandbox,
      contextIsolation: welcome.webContents.getLastWebPreferences().contextIsolation,
      nodeIntegration: welcome.webContents.getLastWebPreferences().nodeIntegration } }),
}
app.on('before-quit', () => {
  login?.cancel()
  server.closeAllConnections()
  server.close()
})
await mkdir(join(root, 'electron'), { recursive: true })
await writeFile(join(root, 'ready.json'), JSON.stringify({ transport: 'real Electron IPC and native callback', provider: 'isolated test server' }))
}
// Electron emits ready after evaluating the entry module; do not block that evaluation with top-level await.
void main().catch((error) => { console.error(error); app.exit(1) })
