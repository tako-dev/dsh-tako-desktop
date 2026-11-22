/** Verify runtime bytes and executable permissions using ASAR records and physical unpacked files. */
import { createHash } from 'node:crypto'
import { lstat, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { readAsar, type Node } from 'app-builder-lib/out/asar/asar.js'
import type { DesktopRuntimeDescriptor, DesktopRuntimeFile } from '../src/runtime-tree.ts'

/**
 * Compare the complete archived dsh tree with the sealed preparation inventory.
 * @param archivePath - Application ASAR file beside its unpacked directory.
 * @param expected - Verified preparation descriptor, including its complete file inventory.
 * @returns Resolves when bytes, file membership and meaningful executable permissions match.
 */
export async function verifyRuntimeArchive(archivePath: string, expected: DesktopRuntimeDescriptor): Promise<void> {
  const archive = await readAsar(archivePath)
  const descriptor = await archive.readFile(join('dsh', 'desktop-runtime.json'))
  if (!descriptor.equals(Buffer.from(`${JSON.stringify(expected, undefined, 2)}\n`))) {
    throw new Error('desktop runtime: archived descriptor differs from preparation')
  }
  const files: DesktopRuntimeFile[] = []
  const unpacked = new Set<string>()
  async function visit(node: Node, path: string): Promise<void> {
    if (node.link !== undefined) throw new Error(`desktop runtime: unexpected ASAR link ${path}`)
    if (node.files !== undefined) {
      for (const [name, child] of Object.entries(node.files)) await visit(child, path === '' ? name : `${path}/${name}`)
      return
    }
    const name = join('dsh', ...path.split('/'))
    const physical = node.unpacked === true ? await lstat(join(`${archivePath}.unpacked`, name)) : undefined
    if (physical !== undefined && !physical.isFile()) throw new Error(`desktop runtime: unexpected unpacked entry ${path}`)
    if (node.unpacked === true) unpacked.add(join(`${archivePath}.unpacked`, name))
    if (path === 'desktop-runtime.json') return
    const body = await archive.readFile(name)
    // ASAR stores only owner-execute; group/other-only executable files fail the inventory comparison.
    const executable = process.platform !== 'win32' && (physical !== undefined
      ? (physical.mode & 0o111) !== 0
      : node.executable === true)
    files.push({ path, bytes: body.byteLength, sha256: createHash('sha256').update(body).digest('hex'), executable })
  }
  await visit(archive.getFile('dsh', false), '')
  const entries = await readdir(join(`${archivePath}.unpacked`, 'dsh'), { recursive: true, withFileTypes: true })
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT' && unpacked.size === 0) return []
      throw error
    })
  for (const entry of entries) {
    if (entry.isDirectory()) continue
    const path = join(entry.parentPath, entry.name)
    if (!entry.isFile() || !unpacked.has(path)) throw new Error(`desktop runtime: unexpected unpacked entry ${path}`)
  }
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  if (JSON.stringify(files) !== JSON.stringify(expected.files)) {
    const differences = inventoryDifferences(files, expected.files)
    const listed = differences.slice(0, 10)
    throw new Error(`desktop runtime: ASAR integrity verification failed (${differences.length} differing entries; first ${listed.length}: ${listed.join('; ')})`)
  }
}

/**
 * Describe every mismatch between the archived inventory and the sealed descriptor.
 * @param actual - Files read back from the ASAR and its physical unpacked copies.
 * @param expected - Sealed preparation inventory.
 * @returns One line per missing, archived-only, or changed file, in walk order.
 */
function inventoryDifferences(actual: readonly DesktopRuntimeFile[], expected: readonly DesktopRuntimeFile[]): string[] {
  const differences: string[] = []
  const expectedByPath = new Map(expected.map(file => [file.path, file]))
  const archivedPaths = new Set(actual.map(file => file.path))
  for (const file of actual) {
    const sealed = expectedByPath.get(file.path)
    if (sealed === undefined) differences.push(`archived-only ${file.path} (${file.bytes} bytes)`)
    else if (sealed.bytes !== file.bytes || sealed.sha256 !== file.sha256 || sealed.executable !== file.executable) {
      differences.push(`changed ${file.path}: sealed ${sealed.bytes} bytes ${sealed.sha256.slice(0, 16)} executable ${Number(sealed.executable)}, archived ${file.bytes} bytes ${file.sha256.slice(0, 16)} executable ${Number(file.executable)}`)
    }
  }
  for (const file of expected) {
    if (!archivedPaths.has(file.path)) differences.push(`missing ${file.path} (${file.bytes} bytes)`)
  }
  return differences
}
