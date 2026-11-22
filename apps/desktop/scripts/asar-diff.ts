/** Diff the sealed desktop-runtime descriptor against the packaged ASAR (diagnostic). */
import { createHash } from 'node:crypto'
import { lstat, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { readAsar, type Node } from 'app-builder-lib/out/asar/asar.js'
import { readDesktopRuntime, type DesktopRuntimeDescriptor, type DesktopRuntimeFile } from '../src/runtime-tree.ts'

async function walk(archive: Awaited<ReturnType<typeof readAsar>>): Promise<DesktopRuntimeFile[]> {
  const files: DesktopRuntimeFile[] = []
  async function visit(node: Node, path: string): Promise<void> {
    if (node.link !== undefined) throw new Error(`unexpected ASAR link ${path}`)
    if (node.files !== undefined) {
      for (const [name, child] of Object.entries(node.files)) await visit(child, path === '' ? name : `${path}/${name}`)
      return
    }
    if (path === 'desktop-runtime.json') return
    const name = join('dsh', ...path.split('/'))
    const physical = node.unpacked === true ? await lstat(join(`${archive.src}.unpacked`, name)) : undefined
    const body = await archive.readFile(name)
    const executable = process.platform !== 'win32' && (physical !== undefined
      ? (physical.mode & 0o111) !== 0
      : node.executable === true)
    files.push({ path, bytes: body.byteLength, sha256: createHash('sha256').update(body).digest('hex'), executable })
  }
  await visit(archive.getFile('dsh', false), '')
  return files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
}

const [archivePath, treeRoot] = [process.argv[2], process.argv[3]]
if (archivePath === undefined || treeRoot === undefined) throw new Error('usage: tsx asar-diff.ts <app.asar> <prepared-dsh-tree>')
const expected: DesktopRuntimeDescriptor = readDesktopRuntime(treeRoot)
const actual = await walk(await readAsar(archivePath))
const expectedPaths = new Map(expected.files.map(f => [f.path, f]))
const actualPaths = new Map(actual.map(f => [f.path, f]))
let diffs = 0
for (const file of actual) {
  const want = expectedPaths.get(file.path)
  if (want === undefined) { console.log(`ASAR-ONLY  ${file.path} (${file.bytes}b unpacked?)`); diffs++ }
  else if (want.bytes !== file.bytes || want.sha256 !== file.sha256 || want.executable !== file.executable) {
    console.log(`CHANGED    ${file.path} want=${want.bytes}b/${want.sha256.slice(0, 12)}/x${Number(want.executable)} got=${file.bytes}b/${file.sha256.slice(0, 12)}/x${Number(file.executable)}`)
    diffs++
  }
}
for (const file of expected.files) {
  if (!actualPaths.has(file.path)) { console.log(`TREE-ONLY  ${file.path} (${file.bytes}b)`); diffs++ }
}
console.log(`${diffs} differing entries; ASAR ${actual.length} files, descriptor ${expected.files.length} files`)
