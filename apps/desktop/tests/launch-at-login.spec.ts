import { readFileSync } from 'node:fs'
import { expect, it, vi } from 'vitest'
import type { MessageBoxOptions } from 'electron'
import { DesktopLaunchAtLogin, electronLoginItems, supportsDesktopLaunchAtLogin,
  type DesktopLoginItems } from '../src/login-items.ts'
import { en, zh } from '../src/locale.ts'

function fixture(platform: NodeJS.Platform, openAtLogin = false) {
  const writes: { openAtLogin?: boolean; path?: string; enabled?: boolean }[] = []
  const loginItems: DesktopLoginItems = {
    getLoginItemSettings: () => ({ openAtLogin }),
    setLoginItemSettings: (settings) => { writes.push(settings); openAtLogin = settings.openAtLogin === true },
  }
  const confirm = vi.fn(async (_options: MessageBoxOptions) => ({ response: 0, checkboxChecked: false }))
  const policy = new DesktopLaunchAtLogin({ loginItems, executable: '/Applications/DSH Tako.app/Contents/MacOS/DSH Tako',
    platform, messages: () => en, confirm })
  return { policy, writes, confirm, set openAtLogin(value: boolean) { openAtLogin = value } }
}

it.each([true, false])('keeps launch at login off until a user opts in on supported platforms (%s)', (open) => {
  const { policy, writes, confirm } = fixture('darwin', open)
  expect(policy.supported()).toBe(true)
  expect(policy.enabled()).toBe(open)
  expect(writes).toEqual([])
  expect(confirm).not.toHaveBeenCalled()
})

it.each(['darwin', 'win32'] as const)('confirms once in the shell language before registering on %s', async (platform) => {
  const { policy, writes, confirm } = fixture(platform)
  expect(await policy.set(true)).toEqual({ kind: 'applied', enabled: true })
  expect(confirm).toHaveBeenCalledOnce()
  expect(confirm.mock.calls[0]![0]).toMatchObject({ type: 'info', title: en.launchAtLoginTitle,
    message: en.launchAtLoginTitle, detail: en.launchAtLoginDetail,
    buttons: [en.launchAtLoginEnable, en.cancel], cancelId: 1 })
  expect(policy.enabled()).toBe(true)
  expect(writes).toHaveLength(1)
})

it('asks the confirmation in Chinese when the shell locale is zh', async () => {
  const { writes, confirm } = fixture('darwin')
  const policy = new DesktopLaunchAtLogin({ loginItems: {
    getLoginItemSettings: () => ({ openAtLogin: false }),
    setLoginItemSettings: (settings) => { writes.push(settings) },
  }, executable: 'DSH Tako', platform: 'darwin', messages: () => zh, confirm })
  await policy.set(true)
  expect(confirm.mock.calls[0]![0]).toMatchObject({ title: zh.launchAtLoginTitle,
    buttons: [zh.launchAtLoginEnable, zh.cancel] })
})

it.each(['darwin', 'win32'] as const)('never registers when the user cancels the confirmation on %s', async (platform) => {
  const { policy, writes, confirm } = fixture(platform)
  confirm.mockResolvedValue({ response: 1, checkboxChecked: false })
  expect(await policy.set(true)).toEqual({ kind: 'cancelled', enabled: false })
  expect(writes).toEqual([])
})

it('passes the executable and approval state to the Windows Run key', async () => {
  const { policy, writes } = fixture('win32')
  await policy.set(true)
  expect(writes).toEqual([{ openAtLogin: true, path: '/Applications/DSH Tako.app/Contents/MacOS/DSH Tako', enabled: true }])
})

it('removes the registration without a confirmation', async () => {
  const { policy, writes, confirm } = fixture('darwin', true)
  expect(await policy.set(false)).toEqual({ kind: 'applied', enabled: false })
  expect(confirm).not.toHaveBeenCalled()
  expect(writes).toEqual([{ openAtLogin: false }])
  const windows = fixture('win32', true)
  expect(await windows.policy.set(false)).toEqual({ kind: 'applied', enabled: false })
  expect(windows.writes).toEqual([{ openAtLogin: false, path: '/Applications/DSH Tako.app/Contents/MacOS/DSH Tako', enabled: false }])
})

it.each(['darwin', 'win32'] as const)('does not re-confirm or rewrite an unchanged selection on %s', async (platform) => {
  const enabled = fixture(platform, true)
  expect(await enabled.policy.set(true)).toEqual({ kind: 'unchanged', enabled: true })
  expect(enabled.confirm).not.toHaveBeenCalled()
  const disabled = fixture(platform)
  expect(await disabled.policy.set(false)).toEqual({ kind: 'unchanged', enabled: false })
})

it.each(['linux', 'freebsd'] as const)('hides and refuses the toggle on %s', async (platform) => {
  const { policy, writes, confirm } = fixture(platform)
  expect(supportsDesktopLaunchAtLogin(platform)).toBe(false)
  expect(policy.supported()).toBe(false)
  expect(policy.enabled()).toBe(false)
  expect(await policy.set(true)).toEqual({ kind: 'unsupported', enabled: false })
  expect(await policy.set(false)).toEqual({ kind: 'unsupported', enabled: false })
  expect(writes).toEqual([])
  expect(confirm).not.toHaveBeenCalled()
})

it('adapts the Electron app object as the login-item seam', () => {
  const calls: { openAtLogin?: boolean }[] = []
  const app = {
    getLoginItemSettings: () => ({ openAtLogin: true, wasOpenedAtLogin: false, status: 'enabled' as const,
      executableWillLaunchAtLogin: true, launchItems: [] }),
    setLoginItemSettings: (settings: { openAtLogin?: boolean }) => { calls.push(settings) },
  }
  const items = electronLoginItems(app as never)
  expect(items.getLoginItemSettings().openAtLogin).toBe(true)
  items.setLoginItemSettings({ openAtLogin: false })
  expect(calls).toEqual([{ openAtLogin: false }])
})

it('drops the login-item Run values and their approval records on Windows uninstall', () => {
  const script = readFileSync(new URL('../installer/uninstall.nsh', import.meta.url), 'utf8')
  const clean = script.slice(script.indexOf('Function un.CleanData'), script.indexOf('/KEEP_APP_DATA'))
  expect(clean).toContain('DeleteRegValue HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Run" "${APP_ID}"')
  expect(clean).toContain('DeleteRegValue HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Run" "${PRODUCT_FILENAME}"')
  expect(clean).toContain('DeleteRegValue HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Run" "${APP_PACKAGE_NAME}"')
  expect(clean).toContain('DeleteRegValue HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run" "${APP_ID}"')
  // The Run entry dies before the /KEEP_APP_DATA early return: it points at the installation being replaced.
  expect(clean.indexOf('DeleteRegValue')).toBeGreaterThan(-1)
})
