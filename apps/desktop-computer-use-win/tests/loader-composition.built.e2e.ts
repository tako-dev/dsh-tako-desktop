import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { loadOverlayPatches, readPluginMeta } from '../../../packages/boot/app-boot/src/index.ts'
import { bundlePatchPaths, composeEntries } from '../../../packages/boot/app-boot/src/profile.ts'

/**
 * Built-artifact composition proof for the observation-only Windows bundle:
 * the package the installer carries must mount through its `dsh.bundle`
 * patch, refuse to load on non-Windows surfaces, and expose its adapter entry
 * through `lib/`. Source assertions (patch rows, bundle metadata, upstream
 * payload) always run; `lib/` consumers self-skip when the build has not
 * run — the `built-bin-smoke` gate is the lane that executes them.
 */

const packageDir = fileURLToPath(new URL('..', import.meta.url))
const repoRoot = join(packageDir, '..', '..')
const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as {
  name: string
  os?: string[]
  dependencies?: Record<string, string>
  dsh?: { bundle?: { patch?: string; platforms?: string[] } }
}
// The built entry resolves its dependencies at import time, so the gate requires their lib outputs too.
const built = existsSync(join(packageDir, 'lib', 'index.js'))
  && existsSync(join(repoRoot, 'vendor/schemastery/lib/index.mjs'))
  && existsSync(join(repoRoot, 'packages/mcp/mcp-client/lib/index.js'))

const OBSERVATION = [
  'health', 'snapshot', 'accessibility_tree', 'list_windows', 'find', 'element_info',
  'wait', 'ocr', 'screenshot', 'wait_for',
] as const
const REFUSED = [
  'click', 'double_click', 'move', 'drag', 'scroll', 'type_text', 'keypress',
  'focus', 'invoke', 'set_value', 'activate_window', 'close_window',
  'move_window', 'launch_app', 'batch', 'tools',
] as const

function upstreamDir(): string {
  const manifestPath = createRequire(join(packageDir, 'package.json')).resolve('dsh-computer-use-win/package.json')
  return dirname(manifestPath)
}

describe('bundle manifest', () => {
  it('is a Windows-only package gated to win32 in both npm and dsh terms', () => {
    expect(manifest.os).toEqual(['win32'])
    expect(manifest.dsh?.bundle?.platforms).toEqual(['win32'])
  })

  it('pins the upstream runtime at an exact version', () => {
    expect(manifest.dependencies?.['dsh-computer-use-win']).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('declares one bundle patch', () => {
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
  })
})

describe('loader composition', () => {
  const patches = bundlePatchPaths(packageDir, { patch: './cordis.patch.yml' })
    .flatMap(path => loadOverlayPatches('test', path))

  it('inserts exactly one adapter row under a stable id', () => {
    const inserted = patches.flatMap(patch => patch.insert ?? [])
    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toMatchObject({
      id: 'desktop-computer-use-win',
      name: '@deepseek-ai/dsh-desktop-computer-use-win',
    })
  })

  it('composes over the shipped Web base without warnings or id collisions', () => {
    const warnings: string[] = []
    const composed = composeEntries([patches], message => warnings.push(message))
    expect(warnings).toEqual([])
    const matches = composed.filter(entry => entry.id === 'desktop-computer-use-win')
    expect(matches).toHaveLength(1)
    expect(matches[0]?.name).toBe('@deepseek-ai/dsh-desktop-computer-use-win')
  })

  it('keeps the bundle off non-Windows hosts through its declared platforms', () => {
    if (process.platform === 'win32') return
    expect(manifest.dsh?.bundle?.platforms).not.toContain(process.platform)
  })

  it('resolves a title, description, and icon in both shipped languages', () => {
    const meta = readPluginMeta(manifest.name, pathToFileURL(join(packageDir, 'package.json')).href)
    expect(meta?.error).toBeUndefined()
    for (const field of [meta?.title, meta?.description]) {
      expect(typeof field).toBe('object')
      for (const language of ['en', 'zh']) expect((field as Record<string, string>)[language]).toMatch(/\S/)
    }
    expect(meta?.icon).toMatch(/^data:image\//)
  })
})

describe('upstream payload', () => {
  it('ships the MCP stdio entry the adapter launches', () => {
    expect(existsSync(join(upstreamDir(), 'mcp', 'server.mjs'))).toBe(true)
  })

  it('ships the PowerShell UIA backend the adapter sweeps', () => {
    expect(existsSync(join(upstreamDir(), 'scripts', 'windows-uia.ps1'))).toBe(true)
  })

  it('is win32-only at the npm level too', () => {
    const upstream = JSON.parse(readFileSync(join(upstreamDir(), 'package.json'), 'utf8')) as { os?: string[] }
    expect(upstream.os).toEqual(['win32'])
  })
})

describe.skipIf(!built)('built lib entry', () => {
  async function adapter(): Promise<typeof import('../src/index.ts')> {
    return await import(pathToFileURL(join(packageDir, 'lib', 'index.js')).href) as typeof import('../src/index.ts')
  }

  it('exports the adapter surface', async () => {
    const entry = await adapter()
    expect(entry.name).toBe('desktop-computer-use-win')
    expect(entry.inject).toEqual(['tools'])
    expect(typeof entry.apply).toBe('function')
    expect(typeof entry.Config).toBe('function')
  })

  it('keeps the observation and refused inventories disjoint and upstream-shaped', async () => {
    const entry = await adapter()
    expect(entry.OBSERVATION_TOOLS).toEqual(OBSERVATION)
    expect(entry.REFUSED_TOOLS).toEqual(REFUSED)
    const observation: ReadonlySet<string> = new Set(entry.OBSERVATION_TOOLS)
    for (const rawName of entry.REFUSED_TOOLS) expect(observation.has(rawName)).toBe(false)
  })

  it('names every tool under the reserved namespace', async () => {
    const entry = await adapter()
    expect(entry.SERVER_NAME).toBe('wincu')
    for (const rawName of entry.OBSERVATION_TOOLS) {
      expect(entry.publicName(rawName)).toBe(`mcp__wincu__windows_computer_use_${rawName}`)
    }
    for (const rawName of entry.REFUSED_TOOLS) {
      expect(entry.publicName(rawName)).toBe(`mcp__wincu__windows_computer_use_${rawName}`)
    }
  })

  it('describes refusals as observation-only in the built output too', async () => {
    const entry = await adapter()
    expect(entry.refusalReason('click')).toContain('observation-only')
  })

  it('rejects refused names during built config validation', async () => {
    const entry = await adapter()
    expect(() => entry.Config({ enabledTools: ['click'] })).toThrow('refused')
    expect(entry.Config({}).enabledTools).toEqual(OBSERVATION)
  })

  it('resolves the upstream server from the built entry', async () => {
    const entry = await adapter()
    const serverPath = entry.resolveUpstreamServer(join(packageDir, 'lib', 'index.js'))
    expect(serverPath.endsWith(join('mcp', 'server.mjs'))).toBe(true)
    expect(existsSync(serverPath)).toBe(true)
  })
})
