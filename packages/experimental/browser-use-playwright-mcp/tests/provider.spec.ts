import { existsSync } from 'node:fs'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, expect, it, vi } from 'vitest'
import { mountSessionMcp } from '@deepseek-ai/dsh-experimental-browser-use-runtime/mcp'
import * as Provider from '../src/index.ts'

vi.mock('@deepseek-ai/dsh-experimental-browser-use-runtime/mcp', async importOriginal => ({
  ...await importOriginal<typeof import('@deepseek-ai/dsh-experimental-browser-use-runtime/mcp')>(),
  mountSessionMcp: vi.fn(),
}))
afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
})

it('uses the pinned Playwright executable with a persistent per-Agent Chromium profile', () => {
  vi.stubEnv('PLAYWRIGHT_MCP_CDP_ENDPOINT', 'http://invalid.example:1')
  Provider.apply(new Context(), Provider.Config({ mode: 'launch', executablePath: '/custom/chromium', toolCallTimeoutMs: 123 }))
  const options = vi.mocked(mountSessionMcp).mock.calls[0]![1]
  const args = typeof options.args === 'function' ? options.args({ id: 'agent-1' } as never) : options.args
  expect(existsSync(args[0]!)).toBe(true)
  expect(options).toMatchObject({ name: 'playwright-mcp', exclusive: false, command: process.execPath, toolCallTimeoutMs: 123 })
  expect(options.env?.PLAYWRIGHT_MCP_CDP_ENDPOINT).toBe('')
  expect(args.slice(1)).toEqual(['--browser', 'chromium', '--headless', '--executable-path', '/custom/chromium', '--user-data-dir', expect.stringContaining('agent-1')])
  expect('default' in Provider).toBe(false)
})

it('supports headed launch and attaches without launching a browser', () => {
  Provider.apply(new Context(), Provider.Config({ mode: 'launch', headless: false }))
  const launch = vi.mocked(mountSessionMcp).mock.calls[0]![1]
  const launchArgs = typeof launch.args === 'function' ? launch.args({ id: 'agent-1' } as never) : launch.args
  expect(launchArgs.slice(1)).toEqual(['--browser', 'chromium', '--user-data-dir', expect.stringContaining('agent-1')])
  Provider.apply(new Context(), Provider.Config({ mode: 'attach', endpoint: 'http://127.0.0.1:9222' }))
  const options = vi.mocked(mountSessionMcp).mock.calls[1]![1]
  expect(options.exclusive).toBe(true)
  expect((typeof options.args === 'function' ? options.args({ id: 'agent-1' } as never) : options.args).slice(1)).toEqual(['--browser', 'chromium', '--cdp-endpoint', 'http://127.0.0.1:9222'])
})

it('keeps an explicitly shared profile root instead of appending an Agent id', () => {
  Provider.apply(new Context(), Provider.Config({
    mode: 'launch', profileMode: 'shared', userDataDir: '/tmp/tako-shared-browser', headless: true,
  }))
  const options = vi.mocked(mountSessionMcp).mock.calls[0]![1]
  const args = typeof options.args === 'function' ? options.args({ id: 'agent-1' } as never) : options.args
  expect(args.slice(1)).toEqual(['--browser', 'chromium', '--headless', '--user-data-dir', '/tmp/tako-shared-browser'])
})

it('rejects malformed endpoints before mounting any browser resources', () => {
  expect(() => { Provider.apply(new Context(), Provider.Config({ mode: 'attach', endpoint: 'http://localhost:bad/path' })) }).toThrow('browser endpoint')
  expect(mountSessionMcp).not.toHaveBeenCalled()
})
