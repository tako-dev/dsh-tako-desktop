import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  TAKO_CLI_COMMAND, TAKO_CLI_COMMAND_DESTINATION, applyTakoDesktopHome, isTakoOpenUrl, takoWindowTitle,
} from '../src/tako-identity.ts'
import {
  TAKO_DESKTOP_APP_ID, TAKO_DESKTOP_CLI_COMMAND, TAKO_DESKTOP_PRODUCT_NAME, TAKO_DESKTOP_VERSION,
  resolveTakoDesktopUpdateChannel, resolveTakoDesktopVersion,
} from '../scripts/tako-desktop-identity.mjs'

describe('DSH Tako identity', () => {
  it('uses its own Harness home unless the launch environment chose one', () => {
    const env: NodeJS.ProcessEnv = {}
    expect(applyTakoDesktopHome(env, '/Users/someone')).toBe(join('/Users/someone', '.dsh-tako'))
    expect(env.DSH_HOME).toBe(join('/Users/someone', '.dsh-tako'))
    const chosen: NodeJS.ProcessEnv = { DSH_HOME: '/data/dsh' }
    expect(applyTakoDesktopHome(chosen, '/Users/someone')).toBe('/data/dsh')
    expect(chosen.DSH_HOME).toBe('/data/dsh')
  })

  it('answers only its own URL scheme and replaces the official title suffix', () => {
    expect(isTakoOpenUrl('dsh-tako://open')).toBe(true)
    expect(isTakoOpenUrl('dsh://open')).toBe(false)
    expect(takoWindowTitle('Plan trip — DeepSeek Harness')).toBe('Plan trip — DSH Tako')
    expect(takoWindowTitle('DeepSeek Harness')).toBe('DSH Tako')
    expect(takoWindowTitle('')).toBe('DSH Tako')
  })

  it('builds a separate product with its own version and a stable GitHub channel', () => {
    expect([TAKO_DESKTOP_PRODUCT_NAME, TAKO_DESKTOP_APP_ID, TAKO_DESKTOP_VERSION]).toEqual(['DSH Tako', 'tech.shiroha.dsh-tako', '0.1.0'])
    expect(resolveTakoDesktopVersion({})).toBe('0.1.0')
    expect(resolveTakoDesktopVersion({ DSH_TAKO_DESKTOP_VERSION: '0.2.0' })).toBe('0.2.0')
    expect(() => resolveTakoDesktopVersion({ DSH_TAKO_DESKTOP_VERSION: 'v0.2' })).toThrow(/strict semantic version/u)
    expect(resolveTakoDesktopUpdateChannel({})).toBe('latest')
  })

  it('installs the dsh-tako terminal command, never the official dsh', () => {
    expect(TAKO_CLI_COMMAND).toBe('dsh-tako')
    expect(TAKO_DESKTOP_CLI_COMMAND).toBe(TAKO_CLI_COMMAND)
    expect(TAKO_CLI_COMMAND_DESTINATION).toBe('/usr/local/bin/dsh-tako')
  })
})
