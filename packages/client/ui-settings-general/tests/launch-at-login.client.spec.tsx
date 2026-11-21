// @vitest-environment jsdom
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { allowAllAccess, bindSnapshotSelector, contextMenuHook } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { LaunchAtLoginRow } from '../src/client/LaunchAtLoginRow.tsx'
import { DesktopLaunchAtLoginSource } from '../src/client/desktop-launch-at-login-source.ts'
import type { DesktopLaunchAtLoginChangeResult, DesktopLaunchAtLoginState } from '../src/types.ts'
import { en } from '../src/client/locales.ts'

const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined, reload: () => {} })) as GlobalStandardProps['useResource']
const usePanelInfo: GlobalStandardProps['usePanelInfo'] = selector => selector({ activePanelId: null })
const unusedHook = (() => { throw new Error('unused by the launch-at-login row') }) as never
const kit = {
  useSessions: unusedHook, useSessionStatus: unusedHook,
  usePanelInfo, useSessionRetainInfo: () => undefined, useResource, useWorkspaces: unusedHook,
  ...allowAllAccess,
  useContextMenu: contextMenuHook(),
}
const t = (key: string): string => (en as Record<string, string>)[key] ?? key

afterEach(() => { cleanup() })

const off: DesktopLaunchAtLoginState = { supported: true, enabled: false }
const on: DesktopLaunchAtLoginState = { supported: true, enabled: true }

function source(bridge: {
  get?: () => Promise<DesktopLaunchAtLoginState>
  set?: (open: boolean) => Promise<DesktopLaunchAtLoginChangeResult>
}) {
  return new DesktopLaunchAtLoginSource({
    get: bridge.get ?? (async () => off),
    set: bridge.set ?? (async () => ({ kind: 'unchanged', enabled: false })),
  })
}

describe('DesktopLaunchAtLoginSource', () => {
  it('shows the registered state once the shell answers', async () => {
    const target = source({ get: async () => on })
    await waitFor(() => { expect(target.store.getSnapshot().state).toEqual(on) })
    target.dispose()
  })

  it('flags a failed read and leaves the toggle disabled', async () => {
    const target = source({ get: () => Promise.reject(new Error('ipc down')) })
    await waitFor(() => { expect(target.store.getSnapshot().failed).toBe(true) })
    expect(target.store.getSnapshot().state).toBeUndefined()
    target.dispose()
  })

  it('applies a confirmed toggle and reports the fresh state', async () => {
    const set = vi.fn(async (): Promise<DesktopLaunchAtLoginChangeResult> => ({ kind: 'applied', enabled: true }))
    const target = source({ set })
    await waitFor(() => { expect(target.store.getSnapshot().state).toEqual(off) })
    await target.select(true)
    expect(set).toHaveBeenCalledWith(true)
    expect(target.store.getSnapshot()).toEqual({ state: on, failed: false })
    target.dispose()
  })

  it('restores the displayed state after a cancelled native confirmation', async () => {
    const target = source({ set: async () => ({ kind: 'cancelled', enabled: false }) })
    await waitFor(() => { expect(target.store.getSnapshot().state).toEqual(off) })
    const pending = target.select(true)
    expect(target.store.getSnapshot().pending).toBe(true)
    await pending
    expect(target.store.getSnapshot()).toEqual({ state: off, failed: false })
    target.dispose()
  })

  it('marks an IPC write failure without inventing a state', async () => {
    const target = source({ set: () => Promise.reject(new Error('ipc down')) })
    await waitFor(() => { expect(target.store.getSnapshot().state).toEqual(off) })
    await target.select(true)
    expect(target.store.getSnapshot()).toEqual({ state: off, failed: true })
    target.dispose()
  })

  it('ignores duplicate, matching and unsupported toggles', async () => {
    const set = vi.fn(async (): Promise<DesktopLaunchAtLoginChangeResult> => ({ kind: 'applied', enabled: true }))
    const target = source({ get: async () => on, set })
    await waitFor(() => { expect(target.store.getSnapshot().state).toEqual(on) })
    await target.select(true)
    expect(set).not.toHaveBeenCalled()
    const pending = target.select(false)
    await target.select(true)
    expect(set).toHaveBeenCalledOnce()
    await pending
    target.dispose()
  })

  it('drops late replies after disposal', async () => {
    const reply = Promise.withResolvers<DesktopLaunchAtLoginState>()
    const target = source({ get: () => reply.promise })
    target.dispose()
    reply.resolve(on)
    await reply.promise
    expect(target.store.getSnapshot()).toEqual({ failed: false })
  })
})

describe('LaunchAtLoginRow', () => {
  it('renders nothing where the OS has no login items', () => {
    const store = createSnapshotStore({ failed: false, state: { supported: false, enabled: false } })
    const { container } = render(<LaunchAtLoginRow {...kit} t={t}
      useLaunchAtLogin={bindSnapshotSelector(store)} select={async () => {}} />)
    expect(container.firstChild).toBeNull()
  })

  it('stays disabled until the shell reports the registration', () => {
    const store = createSnapshotStore({ failed: false })
    render(<LaunchAtLoginRow {...kit} t={t} useLaunchAtLogin={bindSnapshotSelector(store)} select={async () => {}} />)
    const toggle = screen.getByRole('switch', { name: en['desktop.launchAtLogin.title'] })
    expect(toggle.hasAttribute('disabled')).toBe(true)
  })

  it('reports a read failure under the toggle title', () => {
    const store = createSnapshotStore({ failed: true })
    render(<LaunchAtLoginRow {...kit} t={t} useLaunchAtLogin={bindSnapshotSelector(store)} select={async () => {}} />)
    expect(screen.getByRole('alert').textContent).toBe(en['desktop.launchAtLogin.error'])
  })

  it('toggles through the source and re-enables after the answer', async () => {
    const target = source({ set: async () => ({ kind: 'applied', enabled: true }) })
    render(<LaunchAtLoginRow {...kit} t={t} useLaunchAtLogin={bindSnapshotSelector(target.store)}
      select={open => target.select(open)} />)
    await waitFor(() => { expect(target.store.getSnapshot().state).toEqual(off) })
    const toggle = screen.getByRole('switch', { name: en['desktop.launchAtLogin.title'] })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(toggle)
    expect(toggle.hasAttribute('disabled')).toBe(true)
    await waitFor(() => {
      expect(toggle.getAttribute('aria-checked')).toBe('true')
      expect(toggle.hasAttribute('disabled')).toBe(false)
    })
    target.dispose()
  })
})
