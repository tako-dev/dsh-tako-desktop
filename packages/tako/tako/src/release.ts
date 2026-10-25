/** Signed release metadata and CDN selection used by the Tako installer. */

import { createHash, createPublicKey, verify } from 'node:crypto'

/** Platform artifacts supported by the first Desktop distribution. */
export type TakoReleasePlatform = 'windows-x64' | 'macos-arm64' | 'macos-x64'

/** CDN preference exposed by the installer. */
export type TakoCdnChannel = 'domestic' | 'overseas'

/** One immutable download referenced by a signed release manifest. */
export interface TakoReleaseArtifact {
  readonly url: string
  readonly sha256: string
  readonly sizeBytes?: number
}

/** Per-platform, per-CDN Desktop artifact table. */
export type TakoReleaseArtifacts = Record<TakoReleasePlatform, Record<TakoCdnChannel, TakoReleaseArtifact>>

/** Signed Tako bundle tarball metadata. */
export interface TakoBundleArtifact extends TakoReleaseArtifact {
  readonly packageName: '@deepseek-ai/dsh-tako'
  readonly version: string
}

/** Optional signed curated-plugin catalog metadata. */
export interface TakoCuratedManifestRef extends TakoReleaseArtifact {
  readonly version: string
  readonly signature: string
  readonly keyId: string
}

/** One entry in the signed, server-configured Tako-first plugin directory. */
export interface TakoCuratedPlugin {
  readonly packageName: string
  readonly version: string
  readonly required: boolean
  readonly trusted: boolean
  readonly permissions?: readonly string[]
  readonly buildScripts?: readonly string[]
}

/** Parsed curated plugin directory; the full community directory stays separate. */
export interface TakoCuratedCatalog {
  readonly schemaVersion: 1
  readonly version: string
  readonly generatedAt: string
  readonly plugins: readonly TakoCuratedPlugin[]
}

/** Persistence seam for the last verified curated catalog. */
export interface TakoCuratedCatalogStore {
  /** Read a previously verified or serialized catalog value. */
  readonly read: () => Promise<unknown | undefined>
  /** Persist a catalog only after signature, digest, and schema validation. */
  readonly write: (catalog: TakoCuratedCatalog) => Promise<void>
}

/** Result of resolving the curated catalog, including whether it is stale. */
export interface TakoCuratedCatalogResult {
  readonly catalog: TakoCuratedCatalog
  readonly source: 'remote' | 'cache' | 'fallback'
  readonly stale: boolean
  readonly error?: string
}

/** Version-compatible DSH/Tako release unit consumed by an installer. */
export interface TakoReleaseManifest {
  readonly schemaVersion: 1
  readonly release: string
  readonly dshVersion: string
  readonly bundleVersion: string
  readonly minimumDshVersion?: string
  readonly artifacts: TakoReleaseArtifacts
  readonly bundle: TakoBundleArtifact
  readonly curatedManifest?: TakoCuratedManifestRef
}

/** Ordered phases shown by a first-run installer. */
export const TAKO_INSTALL_STEPS = ['download', 'verify', 'configure', 'validate', 'start'] as const
/** One phase of the installation progress sequence. */
export type TakoInstallStep = typeof TAKO_INSTALL_STEPS[number]

/** Platform-independent result of selecting one compatible Desktop artifact. */
export interface TakoInstallPlan {
  readonly platform: TakoReleasePlatform
  readonly hostVersion: string
  readonly manifest: TakoReleaseManifest
  readonly selected: TakoInstallArtifact
  readonly bundle: TakoBundleArtifact
  readonly steps: readonly TakoInstallStep[]
}

/** Installer selection returned after probing CDN candidates. */
export interface TakoInstallArtifact {
  readonly channel: TakoCdnChannel
  readonly artifact: TakoReleaseArtifact
}

/** Progress notification emitted by the manifest-driven installer executor. */
export interface TakoInstallProgress {
  readonly step: TakoInstallStep
  readonly status: 'started' | 'completed' | 'failed'
  readonly completedSteps: readonly TakoInstallStep[]
}

/** OS/application operations supplied by the website installer or Desktop host. */
export interface TakoInstallOperations {
  /** Install the verified DSH Desktop artifact without changing user data. */
  readonly installDesktop: (artifact: Uint8Array, plan: TakoInstallPlan) => Promise<void>
  /** Install the verified Tako bundle artifact into the selected Desktop release. */
  readonly installBundle: (artifact: Uint8Array, plan: TakoInstallPlan) => Promise<void>
  /** Create or update the isolated Tako profile and apply trusted defaults. */
  readonly configure: (plan: TakoInstallPlan) => Promise<void>
  /** Validate the installed host, bundle, and profile before launch. */
  readonly validate: (plan: TakoInstallPlan) => Promise<void>
  /** Launch the installed Desktop and wait until the first-run surface is reachable. */
  readonly start: (plan: TakoInstallPlan) => Promise<void>
  /** Optional progress sink for a native or web installer UI. */
  readonly onProgress?: (progress: TakoInstallProgress) => void | Promise<void>
}

/** Result of a complete install attempt; a thrown error stops before the next step. */
export interface TakoInstallResult {
  readonly plan: TakoInstallPlan
  readonly completedSteps: readonly TakoInstallStep[]
}

/** Fetch seam used by installer callers and keyless tests. */
export type TakoReleaseFetch = typeof fetch

const PLATFORMS: readonly TakoReleasePlatform[] = ['windows-x64', 'macos-arm64', 'macos-x64']
const SHA256 = /^[a-f0-9]{64}$/

/** Map the host runtime to the release platform names understood by the manifest.
 * @param platform - Node.js host platform.
 * @param arch - Host CPU architecture.
 * @returns The matching supported release platform.
 */
export function detectTakoReleasePlatform(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): TakoReleasePlatform {
  if (platform === 'win32' && arch === 'x64') return 'windows-x64'
  if (platform === 'darwin' && arch === 'arm64') return 'macos-arm64'
  if (platform === 'darwin' && arch === 'x64') return 'macos-x64'
  throw new Error(`tako release: unsupported platform ${platform}/${arch}`)
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringField(value: Record<string, unknown>, key: string): string {
  const field = value[key]
  if (typeof field !== 'string' || field.length === 0) throw new Error(`tako release: ${key} must be a non-empty string`)
  return field
}

function booleanField(value: Record<string, unknown>, key: string): boolean {
  if (typeof value[key] !== 'boolean') throw new Error(`tako curated: ${key} must be a boolean`)
  return value[key] as boolean
}

function stringList(value: unknown, key: string): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string' && item.length > 0)) {
    throw new Error(`tako curated: ${key} must be a list of non-empty strings`)
  }
  return [...value] as string[]
}

function httpsURL(value: string, key: string): string {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`tako release: ${key} must be an absolute HTTPS URL`)
  }
  if (parsed.protocol !== 'https:' || parsed.username !== '' || parsed.password !== '') {
    throw new Error(`tako release: ${key} must be an absolute HTTPS URL without credentials`)
  }
  return parsed.href
}

function artifact(value: unknown, key: string): TakoReleaseArtifact {
  if (!record(value)) throw new Error(`tako release: ${key} must be an object`)
  const sha256 = stringField(value, 'sha256').toLowerCase()
  if (!SHA256.test(sha256)) throw new Error(`tako release: ${key}.sha256 must be a 64-character lowercase hex digest`)
  const sizeValue = value.sizeBytes
  if (sizeValue !== undefined && (typeof sizeValue !== 'number' || !Number.isSafeInteger(sizeValue) || sizeValue <= 0)) {
    throw new Error(`tako release: ${key}.sizeBytes must be a positive safe integer`)
  }
  return {
    url: httpsURL(stringField(value, 'url'), `${key}.url`),
    sha256,
    ...sizeValue === undefined ? {} : { sizeBytes: sizeValue },
  }
}

/** Parse and validate untrusted JSON fetched from a release CDN.
 * @param value - Decoded manifest JSON.
 * @returns The validated release manifest.
 */
export function parseTakoReleaseManifest(value: unknown): TakoReleaseManifest {
  if (!record(value) || value.schemaVersion !== 1) throw new Error('tako release: unsupported manifest schema')
  const artifactsValue = value.artifacts
  if (!record(artifactsValue)) throw new Error('tako release: artifacts must be an object')
  const artifacts = {} as TakoReleaseArtifacts
  for (const platform of PLATFORMS) {
    const platformValue = artifactsValue[platform]
    if (!record(platformValue)) throw new Error(`tako release: missing artifacts.${platform}`)
    artifacts[platform] = {
      domestic: artifact(platformValue.domestic, `artifacts.${platform}.domestic`),
      overseas: artifact(platformValue.overseas, `artifacts.${platform}.overseas`),
    }
  }
  const bundleValue = value.bundle
  if (!record(bundleValue) || bundleValue.packageName !== '@deepseek-ai/dsh-tako') {
    throw new Error('tako release: bundle.packageName must be @deepseek-ai/dsh-tako')
  }
  const bundle = {
    ...artifact(bundleValue, 'bundle'),
    packageName: '@deepseek-ai/dsh-tako' as const,
    version: stringField(bundleValue, 'version'),
  }
  const bundleVersion = stringField(value, 'bundleVersion')
  if (bundle.version !== bundleVersion) {
    throw new Error(`tako release: bundle version mismatch (manifest ${bundleVersion}, artifact ${bundle.version})`)
  }
  const curatedValue = value.curatedManifest
  let curatedManifest: TakoCuratedManifestRef | undefined
  if (curatedValue !== undefined) {
    if (!record(curatedValue)) throw new Error('tako release: curatedManifest must be an object')
    curatedManifest = {
      ...artifact(curatedValue, 'curatedManifest'),
      version: stringField(curatedValue, 'version'),
      signature: stringField(curatedValue, 'signature'),
      keyId: stringField(curatedValue, 'keyId'),
    }
  }
  const minimumDshVersion = value.minimumDshVersion
  if (minimumDshVersion !== undefined && typeof minimumDshVersion !== 'string') {
    throw new Error('tako release: minimumDshVersion must be a string')
  }
  return {
    schemaVersion: 1,
    release: stringField(value, 'release'),
    dshVersion: stringField(value, 'dshVersion'),
    bundleVersion,
    ...minimumDshVersion === undefined ? {} : { minimumDshVersion },
    artifacts,
    bundle,
    ...curatedManifest === undefined ? {} : { curatedManifest },
  }
}

/** Parse and validate the signed catalog payload before automatic installation.
 * @param value - Decoded catalog JSON.
 * @returns The validated curated catalog.
 */
export function parseTakoCuratedCatalog(value: unknown): TakoCuratedCatalog {
  if (!record(value) || value.schemaVersion !== 1) throw new Error('tako curated: unsupported catalog schema')
  const pluginValues = value.plugins
  if (!Array.isArray(pluginValues)) throw new Error('tako curated: plugins must be an array')
  const seen = new Set<string>()
  const plugins = pluginValues.map((entry, index): TakoCuratedPlugin => {
    if (!record(entry)) throw new Error(`tako curated: plugins.${String(index)} must be an object`)
    const packageName = stringField(entry, 'packageName')
    if (!/^(?:@[^/\s]+\/[^/\s]+|[a-z0-9][a-z0-9._-]*)$/.test(packageName)) {
      throw new Error(`tako curated: plugins.${String(index)}.packageName is not a package name`)
    }
    if (seen.has(packageName)) throw new Error(`tako curated: duplicate package ${packageName}`)
    seen.add(packageName)
    const permissions = stringList(entry.permissions, `plugins.${String(index)}.permissions`)
    const buildScripts = stringList(entry.buildScripts, `plugins.${String(index)}.buildScripts`)
    return {
      packageName,
      version: stringField(entry, 'version'),
      required: booleanField(entry, 'required'),
      trusted: booleanField(entry, 'trusted'),
      ...permissions === undefined ? {} : { permissions },
      ...buildScripts === undefined ? {} : { buildScripts },
    }
  })
  return {
    schemaVersion: 1,
    version: stringField(value, 'version'),
    generatedAt: stringField(value, 'generatedAt'),
    plugins,
  }
}

/** Entries safe to install without another user confirmation.
 * @param catalog - Validated curated catalog.
 * @returns Required trusted entries without extra permissions or build scripts.
 */
export function automaticTakoCuratedPlugins(catalog: TakoCuratedCatalog): TakoCuratedPlugin[] {
  return catalog.plugins.filter(plugin => plugin.required && plugin.trusted
    && (plugin.permissions?.length ?? 0) === 0
    && (plugin.buildScripts?.length ?? 0) === 0)
}

/** Fetch and validate a release manifest before any artifact download.
 * @param url - HTTPS manifest location.
 * @param fetchImpl - Fetch implementation.
 * @param signal - Optional cancellation signal.
 * @returns The validated release manifest.
 */
export async function fetchTakoReleaseManifest(
  url: string,
  fetchImpl: TakoReleaseFetch = fetch,
  signal?: AbortSignal,
): Promise<TakoReleaseManifest> {
  const manifestURL = httpsURL(url, 'manifest URL')
  const response = await fetchImpl(manifestURL, {
    method: 'GET',
    headers: { accept: 'application/json' },
    ...signal === undefined ? {} : { signal },
  })
  if (!response.ok) throw new Error(`tako release: manifest request failed with HTTP ${response.status}`)
  return parseTakoReleaseManifest(await response.json())
}

/** Resolve the public key for a signed curated catalog key id. */
export type TakoCuratedKeyResolver = (keyId: string) => string | undefined

/** Download, digest-check, signature-check, and parse the curated catalog.
 * @param reference - Signed catalog artifact reference.
 * @param resolvePublicKey - Trusted key lookup by signing-key id.
 * @param fetchImpl - Fetch implementation.
 * @param signal - Optional cancellation signal.
 * @returns The verified curated catalog.
 */
export async function fetchTakoCuratedCatalog(
  reference: TakoCuratedManifestRef,
  resolvePublicKey: TakoCuratedKeyResolver,
  fetchImpl: TakoReleaseFetch = fetch,
  signal?: AbortSignal,
): Promise<TakoCuratedCatalog> {
  const publicKey = resolvePublicKey(reference.keyId)
  if (publicKey === undefined) throw new Error(`tako curated: unknown signing key ${JSON.stringify(reference.keyId)}`)
  const bytes = await downloadTakoArtifact(reference, fetchImpl, signal)
  const payload = new TextDecoder().decode(bytes)
  if (!verifyTakoSignature(payload, reference.signature, publicKey)) {
    throw new Error(`tako curated: signature verification failed for ${JSON.stringify(reference.keyId)}`)
  }
  const catalog = parseTakoCuratedCatalog(JSON.parse(payload))
  if (catalog.version !== reference.version) {
    throw new Error(`tako curated: version mismatch (expected ${reference.version}, got ${catalog.version})`)
  }
  return catalog
}

/**
 * Resolve a signed curated catalog while retaining the last valid result.
 *
 * A network, signature, or schema failure never replaces a valid cache. The
 * optional fallback is used only when no valid cached catalog exists, which
 * lets an installer ship a small safe default before its first refresh.
 * @param reference - Signed catalog artifact reference.
 * @param resolvePublicKey - Trusted key lookup by signing-key id.
 * @param store - Persistence owned by the Desktop/profile caller.
 * @param fallback - Safe shipped catalog used when remote and cache are absent.
 * @param fetchImpl - Fetch implementation.
 * @param signal - Optional cancellation signal.
 * @returns Catalog plus its freshness/source for the UI.
 */
export async function resolveTakoCuratedCatalog(
  reference: TakoCuratedManifestRef,
  resolvePublicKey: TakoCuratedKeyResolver,
  store: TakoCuratedCatalogStore,
  fallback?: TakoCuratedCatalog,
  fetchImpl: TakoReleaseFetch = fetch,
  signal?: AbortSignal,
): Promise<TakoCuratedCatalogResult> {
  try {
    const catalog = await fetchTakoCuratedCatalog(reference, resolvePublicKey, fetchImpl, signal)
    await store.write(catalog)
    return { catalog, source: 'remote', stale: false }
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error)
    try {
      const cached = await store.read()
      if (cached !== undefined) return { catalog: parseTakoCuratedCatalog(cached), source: 'cache', stale: true, error: reason }
    } catch {
      // A corrupt cache is discarded from consideration; the shipped fallback may still be safe.
    }
    if (fallback !== undefined) return { catalog: parseTakoCuratedCatalog(fallback), source: 'fallback', stale: true, error: reason }
    throw error
  }
}

/** Return the auto-detection order without using geolocation or user data.
 * @param preference - Preferred CDN or automatic probing.
 * @returns CDN channels in probe order.
 */
export function cdnOrder(preference: TakoCdnChannel | 'auto' = 'auto'): readonly TakoCdnChannel[] {
  return preference === 'domestic' ? ['domestic', 'overseas']
    : preference === 'overseas' ? ['overseas', 'domestic']
      : ['domestic', 'overseas']
}

/** Select the first reachable signed artifact, falling back to the other CDN.
 * @param manifest - Validated release manifest.
 * @param platform - Target release platform.
 * @param probe - Reachability check for one artifact URL.
 * @param preference - Preferred CDN or automatic probing.
 * @returns The first reachable artifact and its CDN channel.
 */
export async function selectTakoInstallArtifact(
  manifest: TakoReleaseManifest,
  platform: TakoReleasePlatform,
  probe: (url: string) => Promise<boolean>,
  preference: TakoCdnChannel | 'auto' = 'auto',
): Promise<TakoInstallArtifact> {
  const failures: string[] = []
  for (const channel of cdnOrder(preference)) {
    const selected = manifest.artifacts[platform][channel]
    try {
      if (await probe(selected.url)) return { channel, artifact: selected }
      failures.push(`${channel}: unavailable`)
    } catch (error: unknown) {
      failures.push(`${channel}: ${error instanceof Error ? error.message : 'probe failed'}`)
    }
  }
  throw new Error(`tako release: no reachable ${platform} artifact (${failures.join('; ')})`)
}

/**
 * Build the checked, user-visible install plan before downloading anything.
 * The caller still owns writing files, applying the bundle, and launching the
 * official Desktop host; this seam keeps CDN choice and compatibility checks
 * deterministic and testable without an installer binary.
 * @param manifest - Validated release manifest.
 * @param hostVersion - DSH version that will run the bundle.
 * @param platform - Target release platform.
 * @param probe - Reachability check for one artifact URL.
 * @param preference - Preferred CDN or automatic probing.
 * @returns A compatible installation plan.
 */
export async function createTakoInstallPlan(
  manifest: TakoReleaseManifest,
  hostVersion: string,
  platform: TakoReleasePlatform,
  probe: (url: string) => Promise<boolean>,
  preference: TakoCdnChannel | 'auto' = 'auto',
): Promise<TakoInstallPlan> {
  assertTakoCompatibility(manifest, hostVersion)
  const selected = await selectTakoInstallArtifact(manifest, platform, probe, preference)
  return { platform, hostVersion, manifest, selected, bundle: manifest.bundle, steps: TAKO_INSTALL_STEPS }
}

/**
 * Execute a checked install plan through caller-owned OS adapters.
 *
 * Artifact downloads verify size and SHA-256 before the adapters receive any
 * bytes. A failed adapter leaves later steps untouched; the adapter is
 * responsible for its own atomic replacement/rollback semantics. This keeps
 * the same phase machine usable by the Windows installer, the macOS command,
 * and a deterministic test double without pretending that a TypeScript bundle
 * can install an OS application by itself.
 * @param plan - Compatible installation plan.
 * @param operations - Platform operations and progress sink.
 * @param fetchImpl - Fetch implementation.
 * @param signal - Optional cancellation signal.
 * @returns The completed installation plan and phases.
 */
export async function executeTakoInstallPlan(
  plan: TakoInstallPlan,
  operations: TakoInstallOperations,
  fetchImpl: TakoReleaseFetch = fetch,
  signal?: AbortSignal,
): Promise<TakoInstallResult> {
  const completedSteps: TakoInstallStep[] = []
  const run = async (step: TakoInstallStep, operation: () => Promise<void>): Promise<void> => {
    await operations.onProgress?.({ step, status: 'started', completedSteps: [...completedSteps] })
    try {
      await operation()
    } catch (error: unknown) {
      await operations.onProgress?.({ step, status: 'failed', completedSteps: [...completedSteps] })
      throw error
    }
    completedSteps.push(step)
    await operations.onProgress?.({ step, status: 'completed', completedSteps: [...completedSteps] })
  }

  let desktopArtifact: Uint8Array | undefined
  let bundleArtifact: Uint8Array | undefined
  await run('download', async () => {
    [desktopArtifact, bundleArtifact] = await Promise.all([
      downloadTakoArtifact(plan.selected.artifact, fetchImpl, signal),
      downloadTakoArtifact(plan.bundle, fetchImpl, signal),
    ])
  })
  // `downloadTakoArtifact` performs the digest and size checks before return.
  await run('verify', async () => {
    if (desktopArtifact === undefined || bundleArtifact === undefined) {
      throw new Error('tako release: verified artifacts are unavailable')
    }
  })
  await run('configure', async () => {
    if (desktopArtifact === undefined || bundleArtifact === undefined) {
      throw new Error('tako release: verified artifacts are unavailable')
    }
    await operations.installDesktop(desktopArtifact, plan)
    await operations.installBundle(bundleArtifact, plan)
    await operations.configure(plan)
  })
  await run('validate', async () => {
    await operations.validate(plan)
  })
  await run('start', () => operations.start(plan))
  return { plan, completedSteps }
}

/** Compare release versions using numeric semver components and prerelease order.
 * @param left - First release version.
 * @param right - Second release version.
 * @returns Negative, zero, or positive according to version order.
 */
export function compareTakoVersions(left: string, right: string): number {
  const parse = (value: string): { numbers: number[]; pre: string[] } => {
    const [core = '', prerelease = ''] = value.replace(/^v/, '').split('-', 2)
    const numbers = core.split('.').map(part => Number(part))
    if (numbers.length !== 3 || numbers.some(part => !Number.isSafeInteger(part) || part < 0)) {
      throw new Error(`tako release: invalid version ${JSON.stringify(value)}`)
    }
    return { numbers, pre: prerelease === '' ? [] : prerelease.split('.') }
  }
  const a = parse(left)
  const b = parse(right)
  for (let index = 0; index < 3; index += 1) {
    if (a.numbers[index] !== b.numbers[index]) return a.numbers[index]! < b.numbers[index]! ? -1 : 1
  }
  if (a.pre.length === 0 && b.pre.length > 0) return 1
  if (a.pre.length > 0 && b.pre.length === 0) return -1
  for (let index = 0; index < Math.max(a.pre.length, b.pre.length); index += 1) {
    const x = a.pre[index]
    const y = b.pre[index]
    if (x === undefined) return -1
    if (y === undefined) return 1
    if (x === y) continue
    const xn = /^\d+$/.test(x) ? Number(x) : undefined
    const yn = /^\d+$/.test(y) ? Number(y) : undefined
    if (xn !== undefined && yn !== undefined) return xn < yn ? -1 : 1
    if (xn !== undefined) return -1
    if (yn !== undefined) return 1
    return x < y ? -1 : 1
  }
  return 0
}

/** Reject a release whose host version is older than its signed minimum.
 * @param manifest - Validated release manifest.
 * @param hostVersion - DSH version that will run the bundle.
 */
export function assertTakoCompatibility(manifest: TakoReleaseManifest, hostVersion: string): void {
  if (manifest.minimumDshVersion !== undefined
    && compareTakoVersions(hostVersion, manifest.minimumDshVersion) < 0) {
    throw new Error(`tako release: DSH ${hostVersion} is older than required ${manifest.minimumDshVersion}`)
  }
}

/** Verify an artifact's bytes before writing or executing them.
 * @param data - Downloaded artifact bytes.
 * @param expected - Expected SHA-256 hexadecimal digest.
 */
export function verifyTakoSha256(data: Uint8Array, expected: string): void {
  const digest = createHash('sha256').update(data).digest('hex')
  if (digest !== expected.toLowerCase()) throw new Error(`tako release: SHA-256 mismatch (expected ${expected}, got ${digest})`)
}

/** Download one selected artifact and verify its signed digest and size.
 * @param artifact - HTTPS artifact location and expected digest.
 * @param fetchImpl - Fetch implementation.
 * @param signal - Optional cancellation signal.
 * @returns Verified artifact bytes.
 */
export async function downloadTakoArtifact(
  artifact: TakoReleaseArtifact,
  fetchImpl: TakoReleaseFetch = fetch,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const response = await fetchImpl(httpsURL(artifact.url, 'artifact URL'), {
    method: 'GET',
    headers: { accept: 'application/octet-stream' },
    ...signal === undefined ? {} : { signal },
  })
  if (!response.ok) throw new Error(`tako release: artifact request failed with HTTP ${response.status}`)
  const data = new Uint8Array(await response.arrayBuffer())
  if (artifact.sizeBytes !== undefined && data.byteLength !== artifact.sizeBytes) {
    throw new Error(`tako release: artifact size mismatch (expected ${artifact.sizeBytes}, got ${data.byteLength})`)
  }
  verifyTakoSha256(data, artifact.sha256)
  return data
}

/** Verify an Ed25519 signature over a manifest's exact UTF-8 bytes.
 * @param payload - Exact signed UTF-8 payload.
 * @param signatureBase64 - Base64-encoded Ed25519 signature.
 * @param publicKey - Trusted PEM or base64 SPKI public key.
 * @returns Whether the signature matches the payload and key.
 */
export function verifyTakoSignature(payload: string, signatureBase64: string, publicKey: string): boolean {
  const key = publicKey.includes('BEGIN')
    ? createPublicKey(publicKey)
    : createPublicKey({ key: Buffer.from(publicKey, 'base64'), format: 'der', type: 'spki' })
  return verify(null, Buffer.from(payload, 'utf8'), key, Buffer.from(signatureBase64, 'base64'))
}
