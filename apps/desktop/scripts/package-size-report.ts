/** Print a compact size breakdown of one packaged Desktop build so every release log records where the megabytes go. */

import { readdirSync, statSync } from 'node:fs'
import type { Dirent } from 'node:fs'
import { join } from 'node:path'

const MEBIBYTE = 1024 * 1024

function entriesOf(path: string): Dirent[] {
  try {
    return readdirSync(path, { withFileTypes: true })
  } catch {
    return []
  }
}

/** Bytes of one file, or of every regular file under one directory; symbolic links are not followed. */
function sizeOf(path: string): number {
  let stats
  try {
    stats = statSync(path)
  } catch {
    return 0
  }
  if (stats.isFile()) return stats.size
  let total = 0
  for (const entry of entriesOf(path)) {
    if (entry.isDirectory()) total += sizeOf(join(path, entry.name))
    else if (entry.isFile()) total += statSync(join(path, entry.name)).size
  }
  return total
}

/** `12.3 MB` for one byte count. */
function megabytes(bytes: number): string {
  return `${(bytes / MEBIBYTE).toFixed(1)} MB`
}

/**
 * Largest entries of a package container, aggregated per package name.
 * Scoped containers are split into their individual packages so one vendor scope cannot hide the rest.
 * @param root - Container holding installed packages.
 * @param limit - Number of rows to return.
 * @returns `size  name` rows, largest first.
 */
function largestPackages(root: string, limit: number): string[] {
  const rows: { name: string, size: number }[] = []
  for (const entry of entriesOf(root)) {
    if (!entry.isDirectory()) continue
    const path = join(root, entry.name)
    if (entry.name.startsWith('@')) {
      for (const scoped of entriesOf(path)) {
        if (scoped.isDirectory()) rows.push({ name: `${entry.name}/${scoped.name}`, size: sizeOf(join(path, scoped.name)) })
      }
      continue
    }
    rows.push({ name: entry.name, size: sizeOf(path) })
  }
  return rows.sort((left, right) => right.size - left.size).slice(0, limit)
    .map(row => `    ${megabytes(row.size).padStart(9)}  ${row.name}`)
}

/** Locate the packaged application directory electron-builder produced under one artifacts root. */
function findApplication(artifactsRoot: string): string | undefined {
  for (const entry of entriesOf(artifactsRoot)) {
    if (!entry.isDirectory()) continue
    const path = join(artifactsRoot, entry.name)
    if (entry.name === 'win-unpacked' || entry.name.endsWith('.app')) return path
    const nested = entriesOf(path).find(child => child.isDirectory() && child.name.endsWith('.app'))
    if (nested !== undefined) return join(path, nested.name)
  }
  return undefined
}

/**
 * Print the packaged tree's size distribution to the release log.
 * Never throws: a missing or partial build directory must not fail an otherwise successful release.
 * @param artifactsRoot - Directory holding the packaged application and its installers.
 */
export function reportPackageSize(artifactsRoot: string): void {
  try {
    const application = findApplication(artifactsRoot)
    if (application === undefined) return
    const resources = join(application, 'resources')
    const lines = [`desktop package size: ${application} (${megabytes(sizeOf(application))})`]
    if (application.endsWith('.app')) {
      lines.push(`  electron framework ${megabytes(sizeOf(join(application, 'Contents', 'Frameworks')))}`)
    } else {
      lines.push(`  electron runtime ${megabytes(sizeOf(application) - sizeOf(resources))}`)
      const locales = entriesOf(join(application, 'locales'))
      if (locales.length > 0) lines.push(`  locales (${locales.length} files) ${megabytes(sizeOf(join(application, 'locales')))}`)
    }
    for (const name of ['app.asar', 'app.asar.unpacked', 'runtime']) {
      const size = sizeOf(join(resources, name))
      if (size > 0) lines.push(`  resources/${name} ${megabytes(size)}`)
    }
    const primaryRuntime = join(resources, 'runtime', 'primary-runtime')
    for (const name of ['node', 'python', 'pnpm']) {
      const size = sizeOf(join(primaryRuntime, 'dependencies', name))
      if (size > 0) lines.push(`    primary-runtime/${name} ${megabytes(size)}`)
    }
    const dsh = largestPackages(join(resources, 'app.asar.unpacked', 'dsh', 'node_modules'), 5)
    if (dsh.length > 0) lines.push('  largest dsh packages:', ...dsh)
    const python = largestPackages(join(primaryRuntime, 'dependencies', 'python', 'Lib', 'site-packages'), 3)
    if (python.length > 0) lines.push('  largest python packages:', ...python)
    const installers = entriesOf(artifactsRoot)
      .filter(entry => entry.isFile())
      .map(entry => ({ name: entry.name, size: statSync(join(artifactsRoot, entry.name)).size }))
      .sort((left, right) => right.size - left.size)
    for (const installer of installers) lines.push(`  ${megabytes(installer.size).padStart(9)}  ${installer.name}`)
    process.stdout.write(`${lines.join('\n')}\n`)
  } catch (error) {
    process.stdout.write(`desktop package size: unavailable (${error instanceof Error ? error.message : String(error)})\n`)
  }
}
