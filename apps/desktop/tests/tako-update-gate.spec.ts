import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  createTakoDesktopUpdateCompatibilityGate,
  takoDesktopUpdateManifestUrl,
} from '../src/tako-update-gate.ts'

const digest = (value: string): string => createHash('sha256').update(value).digest('hex')

function manifest(version = '1.1.0-rc.2', bundleVersion = '0.2.1-alpha.2') {
  const artifact = (name: string) => ({ url: `https://${name}.example.test/dsh.exe`, sha256: digest(name) })
  return {
    schemaVersion: 1,
    release: '2026.10.14',
    dshVersion: version,
    bundleVersion,
    minimumDshVersion: '1.0.0',
    artifacts: {
      'windows-x64': { domestic: artifact('cn-win'), overseas: artifact('us-win') },
      'macos-arm64': { domestic: artifact('cn-arm'), overseas: artifact('us-arm') },
      'macos-x64': { domestic: artifact('cn-x64'), overseas: artifact('us-x64') },
    },
    bundle: { ...artifact('bundle'), packageName: '@deepseek-ai/dsh-tako', version: bundleVersion },
  }
}

describe('Tako Desktop update compatibility', () => {
  it('does nothing when no public release manifest is configured', async () => {
    expect(createTakoDesktopUpdateCompatibilityGate()).toBeUndefined()
    expect(takoDesktopUpdateManifestUrl({})).toBeUndefined()
  })

  it('accepts only a candidate that is present with the installed bundle version', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(manifest()), { status: 200 })) as typeof fetch
    const gate = createTakoDesktopUpdateCompatibilityGate({
      manifestUrl: 'https://releases.example.test/tako.json',
      bundleVersion: () => '0.2.1-alpha.2',
      fetchImpl,
    })
    await expect(gate?.('1.1.0-rc.2')).resolves.toBeUndefined()
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('fails closed for a missing candidate or a mismatched bundle', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(manifest('1.2.0', '0.3.0')), { status: 200 })) as typeof fetch
    const gate = createTakoDesktopUpdateCompatibilityGate({
      manifestUrl: 'https://releases.example.test/tako.json',
      bundleVersion: () => '0.2.1-alpha.2',
      fetchImpl,
    })
    await expect(gate?.('1.1.0-rc.2')).rejects.toThrow(/does not contain DSH/u)
    await expect(gate?.('1.2.0')).rejects.toThrow(/does not match installed bundle/u)
  })
})
