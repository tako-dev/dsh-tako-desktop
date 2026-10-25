/** Fail-closed compatibility gate for the signed Tako release unit. */

import {
  assertTakoCompatibility,
  fetchTakoReleaseManifest,
  type TakoReleaseFetch,
} from '@deepseek-ai/dsh-tako/release'

/** Inputs used by the Desktop update coordinator before it presents a candidate. */
export interface TakoDesktopUpdateGateOptions {
  /** HTTPS release-manifest URL. Undefined disables the external gate in development. */
  readonly manifestUrl?: string | undefined
  /** Version of the currently packaged Tako bundle, when the runtime descriptor is available. */
  readonly bundleVersion?: () => string | undefined
  /** Fetch seam for tests and for an Electron-owned network implementation. */
  readonly fetchImpl?: TakoReleaseFetch
}

/** Construct the optional update compatibility check used by the official Desktop updater. */
export function createTakoDesktopUpdateCompatibilityGate(
  options: TakoDesktopUpdateGateOptions = {},
): ((candidateVersion: string) => Promise<void>) | undefined {
  const manifestUrl = options.manifestUrl?.trim()
  if (manifestUrl === undefined || manifestUrl === '') return undefined
  let pending: Promise<Awaited<ReturnType<typeof fetchTakoReleaseManifest>>> | undefined
  return async (candidateVersion: string): Promise<void> => {
    pending ??= fetchTakoReleaseManifest(manifestUrl, options.fetchImpl)
      .finally(() => { pending = undefined })
    const manifest = await pending
    if (manifest.dshVersion !== candidateVersion) {
      throw new Error(`desktop update: Tako compatibility manifest does not contain DSH ${candidateVersion}`)
    }
    assertTakoCompatibility(manifest, candidateVersion)
    const bundleVersion = options.bundleVersion?.()
    if (bundleVersion !== undefined && manifest.bundleVersion !== bundleVersion) {
      throw new Error(`desktop update: Tako bundle ${manifest.bundleVersion} does not match installed bundle ${bundleVersion}`)
    }
  }
}

/** Resolve the release-manifest URL without making an unpackaged Desktop require a public endpoint. */
export function takoDesktopUpdateManifestUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = env.TAKO_RELEASE_MANIFEST_URL?.trim()
  return value === undefined || value === '' ? undefined : value
}
