import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  assertTakoCompatibility,
  automaticTakoCuratedPlugins,
  cdnOrder,
  compareTakoVersions,
  createTakoInstallPlan,
  detectTakoReleasePlatform,
  downloadTakoArtifact,
  executeTakoInstallPlan,
  fetchTakoCuratedCatalog,
  fetchTakoReleaseManifest,
  parseTakoReleaseManifest,
  parseTakoCuratedCatalog,
  resolveTakoCuratedCatalog,
  selectTakoInstallArtifact,
  verifyTakoSha256,
  verifyTakoSignature,
} from '../src/release.ts'

const digest = (value: string): string => createHash('sha256').update(value).digest('hex')

function manifest() {
  const artifact = (channel: string) => ({
    url: `https://${channel}.example.test/dsh.exe`,
    sha256: digest(channel),
  })
  return {
    schemaVersion: 1,
    release: '2026.10.14',
    dshVersion: '0.2.1-alpha.2',
    bundleVersion: '0.1.0-rc.5',
    minimumDshVersion: '0.2.0',
    artifacts: {
      'windows-x64': { domestic: artifact('cn-win'), overseas: artifact('us-win') },
      'macos-arm64': { domestic: artifact('cn-mac-arm'), overseas: artifact('us-mac-arm') },
      'macos-x64': { domestic: artifact('cn-mac-x64'), overseas: artifact('us-mac-x64') },
    },
    bundle: {
      ...artifact('bundle'),
      packageName: '@deepseek-ai/dsh-tako',
      version: '0.1.0-rc.5',
    },
  }
}

describe('Tako release manifest', () => {
  it('validates the signed release unit and rejects non-HTTPS artifacts', () => {
    expect(parseTakoReleaseManifest(manifest()).artifacts['windows-x64'].domestic.url)
      .toBe('https://cn-win.example.test/dsh.exe')
    expect(() => parseTakoReleaseManifest({ ...manifest(), artifacts: {
      ...manifest().artifacts,
      'windows-x64': { domestic: { ...manifest().artifacts['windows-x64'].domestic, url: 'http://insecure.test' }, overseas: manifest().artifacts['windows-x64'].overseas },
    } })).toThrow('HTTPS')
    expect(() => parseTakoReleaseManifest({ ...manifest(), bundle: { ...manifest().bundle, version: '0.1.0-rc.4' } }))
      .toThrow('bundle version mismatch')
  })

  it('probes the preferred CDN and falls back without geolocation', async () => {
    const parsed = parseTakoReleaseManifest(manifest())
    const seen: string[] = []
    await expect(selectTakoInstallArtifact(parsed, 'windows-x64', async url => {
      seen.push(url)
      return url.includes('us-win')
    }, 'domestic')).resolves.toMatchObject({ channel: 'overseas' })
    expect(seen).toEqual([
      'https://cn-win.example.test/dsh.exe',
      'https://us-win.example.test/dsh.exe',
    ])
    expect(cdnOrder()).toEqual(['domestic', 'overseas'])
  })

  it('maps supported hosts and builds an install plan before any write', async () => {
    expect(detectTakoReleasePlatform('win32', 'x64')).toBe('windows-x64')
    expect(detectTakoReleasePlatform('darwin', 'arm64')).toBe('macos-arm64')
    expect(() => detectTakoReleasePlatform('linux', 'x64')).toThrow('unsupported platform')
    const parsed = parseTakoReleaseManifest(manifest())
    const plan = await createTakoInstallPlan(parsed, '0.2.1-alpha.2', 'windows-x64', async url => url.includes('us-win'), 'overseas')
    expect(plan).toMatchObject({
      platform: 'windows-x64',
      selected: { channel: 'overseas' },
      bundle: { packageName: '@deepseek-ai/dsh-tako', version: '0.1.0-rc.5' },
      steps: ['download', 'verify', 'configure', 'validate', 'start'],
    })
  })

  it('enforces host compatibility and semver prerelease ordering', () => {
    const parsed = parseTakoReleaseManifest(manifest())
    expect(() => assertTakoCompatibility(parsed, '0.1.9')).toThrow('older than required')
    expect(() => assertTakoCompatibility(parsed, '0.2.1-alpha.2')).not.toThrow()
    expect(compareTakoVersions('0.2.1-alpha.2', '0.2.1')).toBeLessThan(0)
    expect(compareTakoVersions('0.2.1', '0.2.1')).toBe(0)
  })

  it('executes each install phase only after verified downloads', async () => {
    const parsed = parseTakoReleaseManifest(manifest())
    const plan = await createTakoInstallPlan(parsed, '0.2.1-alpha.2', 'windows-x64', async url => url.includes('us-win'), 'overseas')
    const events: string[] = []
    const operations = {
      installDesktop: async (bytes: Uint8Array) => { events.push(`desktop:${new TextDecoder().decode(bytes)}`) },
      installBundle: async (bytes: Uint8Array) => { events.push(`bundle:${new TextDecoder().decode(bytes)}`) },
      configure: async () => { events.push('configure') },
      validate: async () => { events.push('validate') },
      start: async () => { events.push('start') },
      onProgress: ({ step, status }: { step: string; status: string }) => { events.push(`${step}:${status}`) },
    }
    const fetchImpl = (async (input: string | URL) => {
      const url = String(input)
      const bytes = url.includes('us-win') ? new TextEncoder().encode('us-win') : new TextEncoder().encode('bundle')
      return new Response(bytes, { status: 200 })
    }) as typeof fetch
    await expect(executeTakoInstallPlan(plan, operations, fetchImpl)).resolves.toMatchObject({
      completedSteps: ['download', 'verify', 'configure', 'validate', 'start'],
    })
    expect(events).toEqual([
      'download:started', 'download:completed',
      'verify:started', 'verify:completed',
      'configure:started', 'desktop:us-win', 'bundle:bundle', 'configure', 'configure:completed',
      'validate:started', 'validate', 'validate:completed',
      'start:started', 'start', 'start:completed',
    ])
  })

  it('stops before validation and launch when configuration fails', async () => {
    const parsed = parseTakoReleaseManifest(manifest())
    const plan = await createTakoInstallPlan(parsed, '0.2.1-alpha.2', 'windows-x64', async url => url.includes('us-win'), 'overseas')
    const events: string[] = []
    const operations = {
      installDesktop: async () => { events.push('desktop') },
      installBundle: async () => { events.push('bundle') },
      configure: async () => { events.push('configure'); throw new Error('profile write failed') },
      validate: async () => { events.push('validate') },
      start: async () => { events.push('start') },
      onProgress: ({ step, status }: { step: string; status: string }) => { events.push(`${step}:${status}`) },
    }
    const fetchImpl = (async (input: string | URL) => {
      const url = String(input)
      const bytes = url.includes('us-win') ? new TextEncoder().encode('us-win') : new TextEncoder().encode('bundle')
      return new Response(bytes, { status: 200 })
    }) as typeof fetch
    await expect(executeTakoInstallPlan(plan, operations, fetchImpl)).rejects.toThrow('profile write failed')
    expect(events).toEqual([
      'download:started', 'download:completed',
      'verify:started', 'verify:completed',
      'configure:started', 'desktop', 'bundle', 'configure', 'configure:failed',
    ])
  })

  it('verifies bytes and Ed25519 signatures before installation', () => {
    const payload = JSON.stringify(manifest())
    const { privateKey, publicKey } = generateKeyPairSync('ed25519')
    const signature = sign(null, Buffer.from(payload), privateKey).toString('base64')
    expect(verifyTakoSignature(payload, signature, publicKey.export({ type: 'spki', format: 'pem' }).toString())).toBe(true)
    expect(verifyTakoSignature(`${payload} `, signature, publicKey.export({ type: 'spki', format: 'pem' }).toString())).toBe(false)
    expect(() => verifyTakoSha256(new TextEncoder().encode('bundle'), digest('other'))).toThrow('SHA-256 mismatch')
    expect(() => verifyTakoSha256(new TextEncoder().encode('bundle'), digest('bundle'))).not.toThrow()
  })

  it('validates manifests before downloading and verifies downloaded bytes', async () => {
    const payload = manifest()
    const bytes = new TextEncoder().encode('bundle')
    const requests: string[] = []
    const fetchImpl = (async (input: string | URL) => {
      requests.push(String(input))
      if (String(input).endsWith('/manifest.json')) return new Response(JSON.stringify(payload), { status: 200 })
      return new Response(bytes, { status: 200 })
    }) as typeof fetch
    await expect(fetchTakoReleaseManifest('https://releases.example.test/manifest.json', fetchImpl))
      .resolves.toMatchObject({ release: '2026.10.14' })
    await expect(downloadTakoArtifact({
      url: 'https://releases.example.test/bundle.tgz',
      sha256: digest('bundle'),
      sizeBytes: bytes.byteLength,
    }, fetchImpl)).resolves.toEqual(bytes)
    expect(requests).toEqual([
      'https://releases.example.test/manifest.json',
      'https://releases.example.test/bundle.tgz',
    ])
  })

  it('only auto-installs required trusted curated entries without extra execution', () => {
    const catalog = parseTakoCuratedCatalog({
      schemaVersion: 1,
      version: '2026.10.14',
      generatedAt: '2026-10-14T00:00:00Z',
      plugins: [
        { packageName: '@tako/ui', version: '1.2.3', required: true, trusted: true },
        { packageName: '@tako/browser', version: '1.2.3', required: true, trusted: true, buildScripts: ['postinstall'] },
        { packageName: '@tako/optional', version: '1.2.3', required: false, trusted: true },
        { packageName: '@tako/untrusted', version: '1.2.3', required: true, trusted: false },
      ],
    })
    expect(automaticTakoCuratedPlugins(catalog).map(plugin => plugin.packageName)).toEqual(['@tako/ui'])
    expect(() => parseTakoCuratedCatalog({
      schemaVersion: 1,
      version: '1',
      generatedAt: 'now',
      plugins: [{ packageName: '@tako/ui', version: '1', required: true, trusted: true }, { packageName: '@tako/ui', version: '2', required: true, trusted: true }],
    })).toThrow('duplicate package')
  })

  it('accepts a signed curated catalog only when its digest, key, and version agree', async () => {
    const catalogPayload = JSON.stringify({
      schemaVersion: 1,
      version: '2026.10.14',
      generatedAt: '2026-10-14T00:00:00Z',
      plugins: [{ packageName: '@tako/ui', version: '1.2.3', required: true, trusted: true }],
    })
    const { privateKey, publicKey } = generateKeyPairSync('ed25519')
    const signature = sign(null, Buffer.from(catalogPayload), privateKey).toString('base64')
    const reference = {
      url: 'https://cdn.example.test/tako-curated.json',
      sha256: digest(catalogPayload),
      packageName: '@deepseek-ai/dsh-tako' as const,
      version: '2026.10.14',
      signature,
      keyId: 'release-2026',
    }
    const fetchImpl = (async () => new Response(catalogPayload, { status: 200 })) as typeof fetch
    await expect(fetchTakoCuratedCatalog(
      reference,
      keyId => keyId === 'release-2026' ? publicKey.export({ type: 'spki', format: 'pem' }).toString() : undefined,
      fetchImpl,
    )).resolves.toMatchObject({ version: '2026.10.14', plugins: [{ packageName: '@tako/ui' }] })
    await expect(fetchTakoCuratedCatalog(
      { ...reference, signature: Buffer.from('bad').toString('base64') },
      () => publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      fetchImpl,
    )).rejects.toThrow('signature verification failed')
  })

  it('keeps the last verified catalog when a refresh fails', async () => {
    const cached = {
      schemaVersion: 1,
      version: 'cached',
      generatedAt: '2026-10-13T00:00:00Z',
      plugins: [{ packageName: '@tako/cached', version: '1.0.0', required: true, trusted: true }],
    }
    const writes: unknown[] = []
    const result = await resolveTakoCuratedCatalog(
      {
        url: 'https://cdn.example.test/catalog.json', sha256: digest('bad'),
        version: 'remote', signature: Buffer.from('bad').toString('base64'), keyId: 'missing',
      },
      () => undefined,
      { read: async () => cached, write: async value => { writes.push(value) } },
    )
    expect(result).toMatchObject({ source: 'cache', stale: true, catalog: { version: 'cached' } })
    expect(writes).toEqual([])
  })

  it('uses the shipped fallback only when the cache is absent or invalid', async () => {
    const fallback = parseTakoCuratedCatalog({
      schemaVersion: 1, version: 'fallback', generatedAt: '2026-10-14T00:00:00Z',
      plugins: [{ packageName: '@tako/safe', version: '1.0.0', required: true, trusted: true }],
    })
    const result = await resolveTakoCuratedCatalog(
      {
        url: 'https://cdn.example.test/catalog.json', sha256: digest('bad'),
        version: 'remote', signature: Buffer.from('bad').toString('base64'), keyId: 'missing',
      },
      () => undefined,
      { read: async () => ({ nope: true }), write: async () => {} },
      fallback,
    )
    expect(result).toMatchObject({ source: 'fallback', stale: true, catalog: { version: 'fallback' } })
  })
})
