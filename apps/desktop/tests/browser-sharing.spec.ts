import { EventEmitter } from 'node:events'
import { expect, it, vi } from 'vitest'
import { DesktopBrowserSharing } from '../src/browser-sharing.ts'
import type { DesktopBrowserLeaseId } from '@deepseek-ai/dsh-client-ui-sidebar-browser/types'

function guestFixture() {
  const debugging = Object.assign(new EventEmitter(), {
    attach: vi.fn((_protocolVersion?: string): void => {}), detach: vi.fn((): void => {}), isAttached: vi.fn(() => true),
    sendCommand: vi.fn(async (method: string): Promise<unknown> => method === 'Runtime.evaluate'
      ? { result: { value: '{"url":"https://example.test/","text":"Example"}' } } : {}),
  })
  const guest = Object.assign(new EventEmitter(), {
    debugger: debugging, isDestroyed: vi.fn(() => false), getURL: vi.fn(() => 'https://example.test/'),
    loadURL: vi.fn(async (_url: string): Promise<void> => {}), sendInputEvent: vi.fn(),
    capturePage: vi.fn(async () => ({ getSize: () => ({ width: 1_000 }), resize: () => ({ toPNG: () => Buffer.from('png') }), toPNG: () => Buffer.from('png') })),
  })
  return { guest, debugging }
}

it('shares one live guest and revokes it on explicit stop or guest destruction', async () => {
  const events: Array<[string, boolean]> = []
  const browser = new DesktopBrowserSharing((lease, shared) => { events.push([lease, shared]) }, url => url.startsWith('https://'))
  const { guest, debugging } = guestFixture()
  const lease = 'lease-1' as DesktopBrowserLeaseId
  browser.share(lease, 'session-1', guest)
  expect(debugging.attach).toHaveBeenCalledWith('1.3')
  expect((await browser.run('session-1', { action: 'snapshot' }, new AbortController().signal)).text).toContain('Example')
  browser.revoke(lease)
  expect(debugging.detach).toHaveBeenCalledOnce()
  expect(events).toEqual([[lease, true], [lease, false]])
  await expect(browser.run('session-1', { action: 'status' }, new AbortController().signal)).resolves.toMatchObject({ shared: false })
  browser.share(lease, 'session-1', guest)
  guest.emit('destroyed')
  await expect(browser.run('session-1', { action: 'snapshot' }, new AbortController().signal)).rejects.toThrow('No tab is shared')
})

it('rejects navigation outside the allowed application policy', async () => {
  const browser = new DesktopBrowserSharing(() => {}, url => url === 'https://example.test/')
  const { guest } = guestFixture()
  browser.share('lease-2' as DesktopBrowserLeaseId, 'session-2', guest)
  await expect(browser.run('session-2', { action: 'navigate', value: 'http://evil.test/' }, new AbortController().signal))
    .rejects.toThrow('HTTP(S) page outside')
  expect(guest.loadURL).not.toHaveBeenCalled()
})

it('cancels an in-flight page command when sharing is revoked', async () => {
  const browser = new DesktopBrowserSharing(() => {}, url => url.startsWith('https://'))
  const { guest, debugging } = guestFixture()
  debugging.sendCommand.mockImplementation(async () => await new Promise(() => {}))
  const lease = 'lease-3' as DesktopBrowserLeaseId
  browser.share(lease, 'session-3', guest)
  const controller = new AbortController()
  const run = browser.run('session-3', { action: 'snapshot' }, controller.signal)
  await vi.waitFor(() => { expect(debugging.sendCommand).toHaveBeenCalled() })
  browser.revoke(lease)
  await expect(run).rejects.toThrow('Browser action interrupted')
})
