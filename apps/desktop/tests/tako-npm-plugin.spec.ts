import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  desktopProfileBundles, ensureNpmDshTakoManifest, FORKED_TAKO_BUNDLE, installNpmDshTakoPlugin,
  NPM_DSH_TAKO, NPM_DSH_TAKO_VERSION, type SpawnAddRequest,
} from '../src/tako-npm-plugin.ts'

describe('ensureNpmDshTakoManifest', () => {
  it('adds the npm plugin and removes the forked bundle', () => {
    const manifest = {
      dependencies: {} as Record<string, string>,
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-web-app', FORKED_TAKO_BUNDLE] } },
    }
    expect(ensureNpmDshTakoManifest(manifest)).toBe(true)
    expect(manifest.dependencies[NPM_DSH_TAKO]).toBe(NPM_DSH_TAKO_VERSION)
    expect(manifest.dsh.profile.bundles).toEqual(['@deepseek-ai/dsh-web-app'])
  })

  it('does not downgrade a newer pin', () => {
    const manifest = { dependencies: { [NPM_DSH_TAKO]: '0.9.0' } as Record<string, string> }
    expect(ensureNpmDshTakoManifest(manifest)).toBe(false)
    expect(manifest.dependencies[NPM_DSH_TAKO]).toBe('0.9.0')
  })
})

describe('desktopProfileBundles', () => {
  it('keeps official web layers and drops the forked Tako bundle', () => {
    expect(desktopProfileBundles(
      ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'],
      [FORKED_TAKO_BUNDLE, '@deepseek-ai/dsh-experimental-terminal-bundle'],
    )).toEqual([
      '@deepseek-ai/dsh-base',
      '@deepseek-ai/dsh-web-app',
      '@deepseek-ai/dsh-experimental-terminal-bundle',
    ])
  })
})

describe('installNpmDshTakoPlugin', () => {
  it('skips dsh plugin add when the profile already has the plugin', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-tako-plugin-'))
    const pkg = join(root, 'node_modules', NPM_DSH_TAKO)
    mkdirSync(pkg, { recursive: true })
    writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: NPM_DSH_TAKO, version: NPM_DSH_TAKO_VERSION }))
    const spawnAdd = vi.fn()
    await installNpmDshTakoPlugin({ profileDir: root, dshDir: '/opt/dsh', spawnAdd })
    expect(spawnAdd).not.toHaveBeenCalled()
  })

  it('runs dsh plugin add against the official registry', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-tako-plugin-'))
    const dsh = join(root, 'dsh')
    mkdirSync(join(dsh, 'node_modules/@deepseek-ai/dsh/lib'), { recursive: true })
    writeFileSync(join(dsh, 'node_modules/@deepseek-ai/dsh/lib/bin.js'), '')
    const spawnAdd = vi.fn(async (_request: SpawnAddRequest) => ({ status: 0, stdout: '', stderr: '' }))
    await installNpmDshTakoPlugin({
      profileDir: join(root, 'profile'),
      dshDir: dsh,
      execPath: '/usr/bin/node',
      spawnAdd,
    })
    expect(spawnAdd).toHaveBeenCalledTimes(1)
    const args = spawnAdd.mock.calls[0]![0]!.args.join(' ')
    expect(args).toContain('plugin --profile desktop add')
    expect(args).toContain('--registry=https://registry.npmjs.org/')
    expect(args).toContain('--config.minimum-release-age=0')
    expect(args).toContain('dsh-tako@0.5.0')
  })
})
