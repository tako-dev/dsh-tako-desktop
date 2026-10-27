/**
 * Install npm `dsh-tako` into the desktop profile via the desktop-host CLI.
 *
 * 0.1.5 spawned `dsh/lib/bin.js` without `ELECTRON_RUN_AS_NODE`, then stripped
 * `@deepseek-ai/dsh-tako` before the plugin existed. Do not call
 * `stripForkedTakoBundle` / `ensureNpmDshTakoManifest` from startup.
 * Locks: `tests/tako-profile-invariants.spec.ts`.
 * @module desktop/tako-npm-plugin
 */

import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const NPM_DSH_TAKO = 'dsh-tako'
export const NPM_DSH_TAKO_VERSION = '0.5.7'
export const FORKED_TAKO_BUNDLE = '@deepseek-ai/dsh-tako'
export const NPM_REGISTRY = 'https://registry.npmjs.org'
const AGE_FLAG = '--config.minimum-release-age=0'
const INSTALL_TIMEOUT_MS = 120_000

export interface ProfileManifest {
  dependencies?: Record<string, string>
  dsh?: { profile?: { bundles?: string[] } }
}

export function desktopProfileBundles(
  webBundles: readonly string[],
  extras: readonly string[] = [],
): string[] {
  return [...webBundles, ...extras].filter(name => name !== FORKED_TAKO_BUNDLE)
}

function versionTuple(version: string): [number, number, number] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim())
  return match === null ? undefined : [Number(match[1]), Number(match[2]), Number(match[3])]
}

/** Whether `current` sorts before `wanted` for plain x.y.z versions. */
export function isOlder(current: string, wanted: string): boolean {
  const a = versionTuple(current)
  const b = versionTuple(wanted)
  if (a === undefined || b === undefined) return current < wanted
  return a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] < b[2])))
}

/** Drop the forked Tako bundle from the profile layer list. Does not touch dependencies. */
export function stripForkedTakoBundle(manifest: ProfileManifest): boolean {
  const bundles = manifest.dsh?.profile?.bundles
  if (bundles === undefined || !bundles.includes(FORKED_TAKO_BUNDLE)) return false
  manifest.dsh = {
    ...manifest.dsh,
    profile: {
      ...manifest.dsh?.profile,
      bundles: bundles.filter(name => name !== FORKED_TAKO_BUNDLE),
    },
  }
  return true
}

/**
 * Write the npm plugin into the profile manifest and drop the forked bundle
 * from the layer list. Does not run pnpm.
 * @returns whether the manifest object changed.
 */
export function ensureNpmDshTakoManifest(manifest: ProfileManifest, version = NPM_DSH_TAKO_VERSION): boolean {
  let changed = stripForkedTakoBundle(manifest)
  const dependencies = manifest.dependencies ?? {}
  const current = dependencies[NPM_DSH_TAKO]
  if (current === undefined || isOlder(current, version)) {
    dependencies[NPM_DSH_TAKO] = version
    manifest.dependencies = dependencies
    changed = true
  }
  return changed
}

export function installedPluginVersion(profileDir: string): string | undefined {
  try {
    const version = (JSON.parse(readFileSync(join(profileDir, 'node_modules', NPM_DSH_TAKO, 'package.json'), 'utf8')) as { version?: unknown }).version
    return typeof version === 'string' && version !== '' ? version : undefined
  } catch {
    return undefined
  }
}

/** Keep npm `dsh-tako` in the bundle list when it is already installed. Does not strip the forked layer. */
export function restoreNpmDshTakoBundle(projectDir: string): void {
  if (installedPluginVersion(projectDir) === undefined) return
  const path = join(projectDir, 'package.json')
  if (!existsSync(path)) return
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as ProfileManifest
  const bundles = manifest.dsh?.profile?.bundles
  if (bundles === undefined || bundles.includes(NPM_DSH_TAKO)) return
  manifest.dsh = { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles: [...bundles, NPM_DSH_TAKO] } }
  writeFileSync(path, `${JSON.stringify(manifest, undefined, 2)}\n`, { mode: 0o600 })
}

export interface SpawnAddRequest {
  execPath: string
  args: readonly string[]
  env: NodeJS.ProcessEnv
  timeoutMs: number
}

export interface SpawnAddResult {
  status: number | null
  stdout: string
  stderr: string
}

export type SpawnAdd = (request: SpawnAddRequest) => Promise<SpawnAddResult>

async function defaultSpawnAdd(request: SpawnAddRequest): Promise<SpawnAddResult> {
  return await new Promise((resolveSpawn, reject) => {
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const child = spawn(request.execPath, [...request.args], {
      env: request.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, request.timeoutMs)
    child.stdout.on('data', (chunk) => { stdout += String(chunk) })
    child.stderr.on('data', (chunk) => { stderr += String(chunk) })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (status) => {
      clearTimeout(timer)
      if (timedOut) stderr = `${stderr}\ndsh plugin add timed out after ${request.timeoutMs}ms`.trim()
      resolveSpawn({ status, stdout, stderr })
    })
  })
}

function pluginAddArgs(withAgeFlag: boolean, version = NPM_DSH_TAKO_VERSION): string[] {
  const flags = [`--registry=${NPM_REGISTRY}/`]
  if (withAgeFlag) flags.push(AGE_FLAG)
  return ['plugin', '--profile', 'desktop', 'add', ...flags, `${NPM_DSH_TAKO}@${version}`]
}

/** Packaged Host CLI. Do not spawn `dsh/lib/bin.js` from Electron. */
export function desktopHostCli(dshDir: string): string {
  return join(dshDir, 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js')
}

export interface InstallNpmDshTakoOptions {
  profileDir: string
  dshDir: string
  execPath?: string
  env?: NodeJS.ProcessEnv
  spawnAdd?: SpawnAdd
  timeoutMs?: number
  version?: string
}

/** Run `dsh plugin add dsh-tako@<version>` when the profile does not already have it. */
export async function installNpmDshTakoPlugin(options: InstallNpmDshTakoOptions): Promise<void> {
  const version = options.version ?? NPM_DSH_TAKO_VERSION
  const installed = installedPluginVersion(options.profileDir)
  if (installed !== undefined && !isOlder(installed, version)) return
  const cli = desktopHostCli(options.dshDir)
  if (!existsSync(cli)) throw new Error(`desktop tako plugin: desktop-host CLI not found at ${cli}`)
  const spawnAdd = options.spawnAdd ?? defaultSpawnAdd
  const execPath = options.execPath ?? process.execPath
  const env = { ...(options.env ?? process.env), ELECTRON_RUN_AS_NODE: '1' }
  const timeoutMs = options.timeoutMs ?? INSTALL_TIMEOUT_MS
  const run = async (withAgeFlag: boolean): Promise<SpawnAddResult> => spawnAdd({
    execPath,
    args: ['--expose-internals', cli, ...pluginAddArgs(withAgeFlag, version)],
    env,
    timeoutMs,
  })
  let result = await run(true)
  const text = `${result.stderr}\n${result.stdout}`
  if (result.status !== 0 && /unknown option/i.test(text) && /minimum-release-age/i.test(text)) {
    result = await run(false)
  }
  if (result.status !== 0) {
    const detail = [result.stderr, result.stdout].filter(part => part.trim() !== '').join('\n').trim()
    throw new Error(`desktop tako plugin: dsh plugin add failed${detail === '' ? '' : `: ${detail.slice(-400)}`}`)
  }
}
