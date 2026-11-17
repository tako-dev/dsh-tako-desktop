/** Signed release metadata and CDN selection used by the Tako installer. */
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
  readonly read: () => Promise<unknown>
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
export declare const TAKO_INSTALL_STEPS: readonly ['download', 'verify', 'configure', 'validate', 'start']
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
/** Map the host runtime to the release platform names understood by the manifest.
 * @param platform - Node.js host platform.
 * @param arch - Host CPU architecture.
 * @returns The matching supported release platform.
 */
export declare function detectTakoReleasePlatform(platform?: NodeJS.Platform, arch?: string): TakoReleasePlatform
/** Parse and validate untrusted JSON fetched from a release CDN.
 * @param value - Decoded manifest JSON.
 * @returns The validated release manifest.
 */
export declare function parseTakoReleaseManifest(value: unknown): TakoReleaseManifest
/** Parse and validate the signed catalog payload before automatic installation.
 * @param value - Decoded catalog JSON.
 * @returns The validated curated catalog.
 */
export declare function parseTakoCuratedCatalog(value: unknown): TakoCuratedCatalog
/** Entries safe to install without another user confirmation.
 * @param catalog - Validated curated catalog.
 * @returns Required trusted entries without extra permissions or build scripts.
 */
export declare function automaticTakoCuratedPlugins(catalog: TakoCuratedCatalog): TakoCuratedPlugin[]
/** Fetch and validate a release manifest before any artifact download.
 * @param url - HTTPS manifest location.
 * @param fetchImpl - Fetch implementation.
 * @param signal - Optional cancellation signal.
 * @returns The validated release manifest.
 */
export declare function fetchTakoReleaseManifest(
  url: string, fetchImpl?: TakoReleaseFetch, signal?: AbortSignal,
): Promise<TakoReleaseManifest>
/** Resolve the public key for a signed curated catalog key id. */
export type TakoCuratedKeyResolver = (keyId: string) => string | undefined
/** Download, digest-check, signature-check, and parse the curated catalog.
 * @param reference - Signed catalog artifact reference.
 * @param resolvePublicKey - Trusted key lookup by signing-key id.
 * @param fetchImpl - Fetch implementation.
 * @param signal - Optional cancellation signal.
 * @returns The verified curated catalog.
 */
export declare function fetchTakoCuratedCatalog(
  reference: TakoCuratedManifestRef, resolvePublicKey: TakoCuratedKeyResolver,
  fetchImpl?: TakoReleaseFetch, signal?: AbortSignal,
): Promise<TakoCuratedCatalog>
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
export declare function resolveTakoCuratedCatalog(
  reference: TakoCuratedManifestRef, resolvePublicKey: TakoCuratedKeyResolver,
  store: TakoCuratedCatalogStore, fallback?: TakoCuratedCatalog,
  fetchImpl?: TakoReleaseFetch, signal?: AbortSignal,
): Promise<TakoCuratedCatalogResult>
/** Return the auto-detection order without using geolocation or user data.
 * @param preference - Preferred CDN or automatic probing.
 * @returns CDN channels in probe order.
 */
export declare function cdnOrder(preference?: TakoCdnChannel | 'auto'): readonly TakoCdnChannel[]
/** Select the first reachable signed artifact, falling back to the other CDN.
 * @param manifest - Validated release manifest.
 * @param platform - Target release platform.
 * @param probe - Reachability check for one artifact URL.
 * @param preference - Preferred CDN or automatic probing.
 * @returns The first reachable artifact and its CDN channel.
 */
export declare function selectTakoInstallArtifact(manifest: TakoReleaseManifest, platform: TakoReleasePlatform, probe: (url: string) => Promise<boolean>, preference?: TakoCdnChannel | 'auto'): Promise<TakoInstallArtifact>
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
export declare function createTakoInstallPlan(manifest: TakoReleaseManifest, hostVersion: string, platform: TakoReleasePlatform, probe: (url: string) => Promise<boolean>, preference?: TakoCdnChannel | 'auto'): Promise<TakoInstallPlan>
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
export declare function executeTakoInstallPlan(
  plan: TakoInstallPlan, operations: TakoInstallOperations,
  fetchImpl?: TakoReleaseFetch, signal?: AbortSignal,
): Promise<TakoInstallResult>
/** Compare release versions using numeric semver components and prerelease order.
 * @param left - First release version.
 * @param right - Second release version.
 * @returns Negative, zero, or positive according to version order.
 */
export declare function compareTakoVersions(left: string, right: string): number
/** Reject a release whose host version is older than its signed minimum.
 * @param manifest - Validated release manifest.
 * @param hostVersion - DSH version that will run the bundle.
 */
export declare function assertTakoCompatibility(manifest: TakoReleaseManifest, hostVersion: string): void
/** Verify an artifact's bytes before writing or executing them.
 * @param data - Downloaded artifact bytes.
 * @param expected - Expected SHA-256 hexadecimal digest.
 */
export declare function verifyTakoSha256(data: Uint8Array, expected: string): void
/** Download one selected artifact and verify its signed digest and size.
 * @param artifact - HTTPS artifact location and expected digest.
 * @param fetchImpl - Fetch implementation.
 * @param signal - Optional cancellation signal.
 * @returns Verified artifact bytes.
 */
export declare function downloadTakoArtifact(
  artifact: TakoReleaseArtifact, fetchImpl?: TakoReleaseFetch, signal?: AbortSignal,
): Promise<Uint8Array>
/** Verify an Ed25519 signature over a manifest's exact UTF-8 bytes.
 * @param payload - Exact signed UTF-8 payload.
 * @param signatureBase64 - Base64-encoded Ed25519 signature.
 * @param publicKey - Trusted PEM or base64 SPKI public key.
 * @returns Whether the signature matches the payload and key.
 */
export declare function verifyTakoSignature(payload: string, signatureBase64: string, publicKey: string): boolean
//# sourceMappingURL=release.d.ts.map
