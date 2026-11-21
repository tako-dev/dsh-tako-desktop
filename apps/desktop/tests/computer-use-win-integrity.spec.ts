/**
 * The opt-in computer-use bundle's packaging contract: the package-set
 * closure admits it only on the Windows target, the lockfile gate pins its
 * upstream npm dependency at the reviewed resolution, and the packaging flag
 * refuses every non-Windows target.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  DESKTOP_COMPUTER_USE_WIN_PACKAGE,
  DESKTOP_COMPUTER_USE_WIN_UPSTREAM,
  DESKTOP_HOST_PACKAGE,
  DESKTOP_NPM_DEPENDENCY_PINS,
  parseDesktopCorePackageSet,
  verifyDesktopCoreLockfile,
  type DesktopCorePackageRecord,
} from '../src/core-package-set.ts'
import { COMPUTER_USE_WIN_PACKAGE, selectDesktopPackageClosure, type PackedDesktopPackage } from '../scripts/prepare-package-set.ts'
import { parseDesktopPackageInvocation } from '../scripts/package-target.ts'

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))

function record(name: string, version = '0.2.2-rc.3'): DesktopCorePackageRecord {
  return {
    name, version,
    file: `${name.replace(/^@deepseek-ai\//, 'deepseek-ai-').replace('/', '-')}-${version}.tgz`,
    bytes: 1,
    integrity: `sha512-${'a'.repeat(86)}==`,
  }
}

const BASE_RECORDS = ['@deepseek-ai/dsh', DESKTOP_HOST_PACKAGE, '@deepseek-ai/dsh-tako'].map(name => record(name))
const CARRIER_RECORD = record(DESKTOP_COMPUTER_USE_WIN_PACKAGE)

function packageSet(withCarrier: boolean) {
  const packages = [...BASE_RECORDS, ...(withCarrier ? [CARRIER_RECORD] : [])]
    .sort((left, right) => left.name.localeCompare(right.name))
  return parseDesktopCorePackageSet({ schemaVersion: 1, packages })
}

const PINNED_LOCKFILE = [
  'packages:',
  '',
  `  '${DESKTOP_COMPUTER_USE_WIN_UPSTREAM.name}@${DESKTOP_COMPUTER_USE_WIN_UPSTREAM.version}':`,
  `    resolution: {integrity: ${DESKTOP_COMPUTER_USE_WIN_UPSTREAM.integrity}}`,
  '    os: [win32]',
  '',
].join('\n')

describe('upstream pin', () => {
  it('names the package set member it guards', () => {
    expect(DESKTOP_NPM_DEPENDENCY_PINS.get(DESKTOP_COMPUTER_USE_WIN_PACKAGE)).toBe(DESKTOP_COMPUTER_USE_WIN_UPSTREAM)
    expect(COMPUTER_USE_WIN_PACKAGE).toBe(DESKTOP_COMPUTER_USE_WIN_PACKAGE)
  })

  it('matches the workspace package name and its npm dependency', () => {
    const manifest = JSON.parse(
      readFileSync(join(repoRoot, 'apps/desktop-computer-use-win/package.json'), 'utf8'),
    ) as { name: string; dependencies: Record<string, string> }
    expect(manifest.name).toBe(DESKTOP_COMPUTER_USE_WIN_PACKAGE)
    expect(manifest.dependencies[DESKTOP_COMPUTER_USE_WIN_UPSTREAM.name]).toBe(DESKTOP_COMPUTER_USE_WIN_UPSTREAM.version)
  })

  it('carries a sha512 registry integrity', () => {
    expect(DESKTOP_COMPUTER_USE_WIN_UPSTREAM.integrity).toMatch(/^sha512-[A-Za-z0-9+/]+={0,2}$/u)
  })
})

describe('verifyDesktopCoreLockfile', () => {
  it('accepts the reviewed upstream resolution when the carrier is present', () => {
    expect(() => { verifyDesktopCoreLockfile(PINNED_LOCKFILE, packageSet(true)) }).not.toThrow()
  })

  it('rejects a tampered upstream integrity', () => {
    const tampered = PINNED_LOCKFILE.replace(DESKTOP_COMPUTER_USE_WIN_UPSTREAM.integrity, `sha512-${'b'.repeat(86)}==`)
    expect(() => { verifyDesktopCoreLockfile(tampered, packageSet(true)) })
      .toThrow('does not match the reviewed pin')
  })

  it('rejects a lockfile missing the upstream resolution the carrier needs', () => {
    expect(() => { verifyDesktopCoreLockfile('packages:\n', packageSet(true)) })
      .toThrow(`does not resolve ${DESKTOP_COMPUTER_USE_WIN_UPSTREAM.name}@${DESKTOP_COMPUTER_USE_WIN_UPSTREAM.version}`)
  })

  it('ignores the pin when the carrier is not in the package set', () => {
    expect(() => { verifyDesktopCoreLockfile('packages:\n', packageSet(false)) }).not.toThrow()
  })

  it('still rejects a registry-resolved carrier name', () => {
    const lockfile = [
      'packages:',
      '',
      `  '${CARRIER_RECORD.name}@${CARRIER_RECORD.version}':`,
      `    resolution: {integrity: ${DESKTOP_COMPUTER_USE_WIN_UPSTREAM.integrity}}`,
      '',
      `  '${DESKTOP_COMPUTER_USE_WIN_UPSTREAM.name}@${DESKTOP_COMPUTER_USE_WIN_UPSTREAM.version}':`,
      `    resolution: {integrity: ${DESKTOP_COMPUTER_USE_WIN_UPSTREAM.integrity}}`,
      '',
    ].join('\n')
    expect(() => { verifyDesktopCoreLockfile(lockfile, packageSet(true)) })
      .toThrow('outside the local package set')
  })
})

function packed(name: string, manifest: Record<string, unknown> = {}): PackedDesktopPackage {
  return { tarball: `/packed/${name.replace('/', '-')}.tgz`, manifest: { name, ...manifest } }
}

describe('selectDesktopPackageClosure opt-in root', () => {
  const carrier = packed(DESKTOP_COMPUTER_USE_WIN_PACKAGE, { os: ['win32'], version: '0.2.2-rc.3' })
  const available = new Map<string, PackedDesktopPackage>([
    packed('@deepseek-ai/dsh'),
    packed(DESKTOP_HOST_PACKAGE),
    packed('@deepseek-ai/dsh-tako'),
    carrier,
  ].map(entry => [(entry.manifest as { name: string }).name, entry]))

  it('omits the opt-in bundle by default', () => {
    const selected = selectDesktopPackageClosure(available, { platform: 'win32', arch: 'x64' })
    expect(selected.map(entry => entry.manifest.name)).not.toContain(DESKTOP_COMPUTER_USE_WIN_PACKAGE)
  })

  it('admits the opt-in bundle on the Windows target', () => {
    const selected = selectDesktopPackageClosure(available, { platform: 'win32', arch: 'x64' }, [DESKTOP_COMPUTER_USE_WIN_PACKAGE])
    const names = selected.map(entry => String(entry.manifest.name))
    expect(names).toContain(DESKTOP_COMPUTER_USE_WIN_PACKAGE)
    expect([...names]).toEqual([...names].sort((left, right) => left.localeCompare(right)))
  })

  it('refuses the opt-in bundle on a non-Windows target', () => {
    expect(() => { selectDesktopPackageClosure(available, { platform: 'darwin', arch: 'arm64' }, [DESKTOP_COMPUTER_USE_WIN_PACKAGE]) })
      .toThrow(`${DESKTOP_COMPUTER_USE_WIN_PACKAGE} does not support darwin-arm64`)
  })

  it('fails loud when the opt-in bundle was never packed', () => {
    const without = new Map(available)
    without.delete(DESKTOP_COMPUTER_USE_WIN_PACKAGE)
    expect(() => { selectDesktopPackageClosure(without, { platform: 'win32', arch: 'x64' }, [DESKTOP_COMPUTER_USE_WIN_PACKAGE]) })
      .toThrow(`packed inputs omit ${DESKTOP_COMPUTER_USE_WIN_PACKAGE}`)
  })
})

describe('--computer-use-win', () => {
  it('defaults off', () => {
    const invocation = parseDesktopPackageInvocation([], 'darwin', 'arm64')
    expect(invocation.computerUseWin).toBe(false)
  })

  it('activates on the Windows target', () => {
    const invocation = parseDesktopPackageInvocation(['--computer-use-win', 'win-x64'], 'win32', 'x64')
    expect(invocation.target.name).toBe('win-x64')
    expect(invocation.computerUseWin).toBe(true)
  })

  it.each(['mac-arm64', 'mac-x64'] as const)('refuses the %s target', (name) => {
    expect(() => { parseDesktopPackageInvocation(['--computer-use-win', name], 'win32', 'x64') })
      .toThrow('--computer-use-win carries a Windows-only runtime and requires the win-x64 target')
  })

  it('refuses the host default target on non-Windows build hosts', () => {
    expect(() => { parseDesktopPackageInvocation(['--computer-use-win'], 'darwin', 'arm64') })
      .toThrow('--computer-use-win carries a Windows-only runtime and requires the win-x64 target')
  })
})
