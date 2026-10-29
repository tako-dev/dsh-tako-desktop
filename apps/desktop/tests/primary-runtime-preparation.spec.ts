/** Desktop carriers keep a complete interpreter payload even when SDK carriers choose Python-only. */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { prunePrimaryRuntime, smokePrimaryRuntime } from '../scripts/prepare-primary-runtime.ts'

it('removes the vendored pnpm helper the packaged architecture cannot run', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-vendor-prune-'))
  try {
    const vendor = join(root, 'dependencies', 'pnpm', 'dist', 'vendor')
    await mkdir(vendor, { recursive: true })
    for (const name of ['fastlist-0.3.0-x64.exe', 'fastlist-0.3.0-x86.exe', 'notes.txt']) {
      await writeFile(join(vendor, name), name)
    }
    expect(prunePrimaryRuntime(root, 'win-x64')).toEqual(['fastlist-0.3.0-x86.exe'])
    expect(existsSync(join(vendor, 'fastlist-0.3.0-x64.exe'))).toBe(true)
    expect(existsSync(join(vendor, 'notes.txt'))).toBe(true)
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('rejects a Python-only native Desktop payload before executing interpreters', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-python-only-'))
  try {
    await writeFile(join(root, 'runtime.json'), JSON.stringify({
      desktopVersion: '1.0.0', platform: process.platform, arch: process.arch,
      python: '3.12.14', pythonPackages: { numpy: '2.3.5', pandas: '3.0.1' },
    }))
    expect(() => { smokePrimaryRuntime(root) }).toThrow('Desktop payload must declare node and pnpm')
  } finally { await rm(root, { recursive: true, force: true }) }
})
