/**
 * CANNOT-BREAK locks from 2026-10-26 (DSH Tako 0.1.5).
 *
 * 0.1.5 stripped `@deepseek-ai/dsh-tako` from the desktop profile and failed
 * to install npm `dsh-tako`, so every Tako model and tool vanished. Do not
 * weaken, skip, or delete these tests. Packaging smoke repeats the same
 * checks in `scripts/smoke-runtime.ts`.
 *
 * Incident: my-documents `incidents/2026-10-26-dsh-tako-desktop-stripped-tako-bundle.md`
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PROFILE_TEMPLATES } from '@deepseek-ai/dsh-app-boot'
import { resolveDesktopPaths } from '../src/paths.ts'
import {
  createPluginProfile, DesktopProjectManager, FORKED_TAKO_BUNDLE,
} from '../src/project-manager.ts'
import { takoCredentialSettings } from '../src/welcome-backend.ts'
import { runtimeFixture } from './runtime-fixture.ts'

const NPM_DSH_TAKO = 'dsh-tako'
const roots: string[] = []

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-tako-invariant-'))
  roots.push(root)
  return root
}

function readProfile(profileDir: string): {
  dependencies: Record<string, string>
  bundles: string[]
} {
  const manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>
    dsh?: { profile?: { bundles?: string[] } }
  }
  return {
    dependencies: manifest.dependencies ?? {},
    bundles: manifest.dsh?.profile?.bundles ?? [],
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('tako profile invariants (do not break)', () => {
  it('the shipped tako template still lists the bundled Tako provider', () => {
    expect(PROFILE_TEMPLATES.tako?.bundles).toContain(FORKED_TAKO_BUNDLE)
    const bundles = PROFILE_TEMPLATES.tako?.bundles ?? []
    expect(bundles.indexOf(FORKED_TAKO_BUNDLE))
      .toBe(bundles.indexOf('@deepseek-ai/dsh-web-app') + 1)
  })

  it('a new desktop profile keeps the bundled Tako provider and does not pin npm dsh-tako', () => {
    const root = temporaryRoot()
    const profile = join(root, 'profiles', 'desktop')
    mkdirSync(join(root, 'profiles'), { recursive: true })
    createPluginProfile(profile)
    const { dependencies, bundles } = readProfile(profile)
    expect(bundles).toContain(FORKED_TAKO_BUNDLE)
    expect(bundles.indexOf(FORKED_TAKO_BUNDLE)).toBe(bundles.indexOf('@deepseek-ai/dsh-web-app') + 1)
    expect(dependencies[NPM_DSH_TAKO]).toBeUndefined()
  })

  it('applyRelease restores a profile that had the bundled Tako provider stripped', async () => {
    const root = temporaryRoot()
    const dsh = join(root, 'resources', 'dsh')
    runtimeFixture(dsh)
    const manager = new DesktopProjectManager(resolveDesktopPaths(join(root, '.dsh')), { dsh })
    await manager.applyRelease()
    const path = join(manager.paths.profile, 'package.json')
    const manifest = JSON.parse(readFileSync(path, 'utf8')) as {
      dependencies?: Record<string, string>
      dsh: { profile: { bundles: string[] } }
    }
    manifest.dsh.profile.bundles = manifest.dsh.profile.bundles.filter(name => name !== FORKED_TAKO_BUNDLE)
    writeFileSync(path, `${JSON.stringify(manifest, undefined, 2)}\n`)
    await manager.applyRelease()
    const { dependencies, bundles } = readProfile(manager.paths.profile)
    expect(bundles).toContain(FORKED_TAKO_BUNDLE)
    expect(dependencies[NPM_DSH_TAKO]).toBeUndefined()
  })

  it('startup may install npm dsh-tako but must not strip the bundled Tako layer', () => {
    const manager = readFileSync(join(import.meta.dirname, '../src/project-manager.ts'), 'utf8')
    const main = readFileSync(join(import.meta.dirname, '../src/main.ts'), 'utf8')
    const plugin = readFileSync(join(import.meta.dirname, '../src/tako-npm-plugin.ts'), 'utf8')
    expect(manager).not.toMatch(/stripForkedTakoBundle|ensureNpmDshTakoManifest/)
    expect(main).not.toMatch(/stripForkedTakoBundle|ensureNpmDshTakoManifest/)
    expect(main).toMatch(/installTakoPlugin/)
    expect(plugin).toMatch(/dsh-desktop-host/)
    expect(plugin).toMatch(/ELECTRON_RUN_AS_NODE/)
    expect(plugin).toMatch(/args: \['--expose-internals', cli,/)
    expect(plugin).not.toMatch(/join\(options\.dshDir, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin\.js'\)/)
  })

  it('installTakoPlugin failure leaves the bundled Tako layer unpinned', async () => {
    const root = temporaryRoot()
    const dsh = join(root, 'resources', 'dsh')
    runtimeFixture(dsh)
    const manager = new DesktopProjectManager(resolveDesktopPaths(join(root, '.dsh')), { dsh })
    await manager.applyRelease()
    await manager.installTakoPlugin()
    const { dependencies, bundles } = readProfile(manager.paths.profile)
    expect(bundles).toContain(FORKED_TAKO_BUNDLE)
    expect(dependencies[NPM_DSH_TAKO]).toBeUndefined()
  })

  it('welcome still treats bundled ns tako as Tako credentials', () => {
    expect(takoCredentialSettings([{ ns: 'tako', value: { apiKeyEnv: 'TAKO_API_KEY' } }]))
      .toEqual({ apiKeyEnv: 'TAKO_API_KEY' })
    expect(takoCredentialSettings([{ ns: 'llm-tako', value: { apiKeyEnv: 'TAKO_API_KEY' } }]))
      .toEqual({ apiKeyEnv: 'TAKO_API_KEY' })
    expect(takoCredentialSettings([{ ns: 'dsh-tako', value: { apiKeyEnv: 'TAKO_API_KEY' } }]))
      .toEqual({ apiKeyEnv: 'TAKO_API_KEY' })
  })

  it('keeps an already-installed npm plugin in the profile with the bundled Tako layer', async () => {
    const root = temporaryRoot()
    const dsh = join(root, 'resources', 'dsh')
    runtimeFixture(dsh)
    const manager = new DesktopProjectManager(resolveDesktopPaths(join(root, '.dsh')), { dsh })
    await manager.applyRelease()
    const plugin = join(manager.paths.profile, 'node_modules', NPM_DSH_TAKO)
    mkdirSync(plugin, { recursive: true })
    writeFileSync(join(plugin, 'package.json'), JSON.stringify({ name: NPM_DSH_TAKO, version: '0.5.0' }))
    await manager.applyRelease()
    const { bundles, dependencies } = readProfile(manager.paths.profile)
    expect(bundles).toContain(FORKED_TAKO_BUNDLE)
    expect(bundles).toContain(NPM_DSH_TAKO)
    expect(dependencies[NPM_DSH_TAKO]).toBeUndefined()
  })
})
