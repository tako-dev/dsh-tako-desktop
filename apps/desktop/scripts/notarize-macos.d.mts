/** Notarize with separate upload and wait timings while preserving signature checks and stapling. */
import type { MacOSNotarizationEnvironment } from './desktop-release-environment.mjs'
import type { StapleRetryPolicy } from './macos-staple-retry.mjs'

/** Apple operations replaced by deterministic fixtures in orchestration tests. */
export interface NotarizeMacOSDependencies {
  /** Packaging environment that supplies the stapler retry budget; defaults to `process.env`. */
  readonly environment?: NodeJS.ProcessEnv
  /** Notarization submission; defaults to electron-notarize with the logged notarytool adapter. */
  readonly submit?: (options: MacOSNotarizationEnvironment & { appPath: string; notarytoolPath: string }) => Promise<void>
  /** Post-acceptance stapling; defaults to the retried `xcrun stapler staple` path. */
  readonly staple?: (appPath: string, options: { policy: StapleRetryPolicy; environment: NodeJS.ProcessEnv }) => Promise<void>
}

/** Overrides for one stapling retry sequence. */
export interface StapleMacOSArtifactOptions {
  readonly policy?: StapleRetryPolicy
  readonly environment?: NodeJS.ProcessEnv
  readonly execute?: (appPath: string) => Promise<void>
  readonly sleep?: (milliseconds: number) => Promise<void> | void
}

/**
 * Retry stapling an artifact whose notarization was already accepted, without resubmitting it.
 * @param appPath - Packaged `.app` directory or `.dmg` file.
 * @param options - Retry overrides.
 */
export function stapleMacOSArtifact(appPath: string, options?: StapleMacOSArtifactOptions): Promise<void>

/**
 * Notarize and staple an App or DMG through the measured notarytool adapter.
 * @param options - Validated Apple credentials and artifact path.
 * @param dependencies - Injectable Apple operations for tests.
 * @returns Resolves after acceptance and stapling; failures remain in the packaging journal.
 */
export function notarizeMacOS(
  options: MacOSNotarizationEnvironment & { appPath: string },
  dependencies?: NotarizeMacOSDependencies,
): Promise<void>
