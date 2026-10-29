/**
 * Read the DSH Tako application version constant from the identity module source without loading its dependencies.
 * @param source - Text of scripts/tako-desktop-identity.mjs.
 * @returns The TAKO_DESKTOP_VERSION literal.
 */
export function readTakoDesktopVersionSource(source: string): string

/**
 * Resolve the application version a release tag publishes and require it to equal the source version.
 * @param tag - Git tag, for example `v0.1.0`.
 * @param sourceVersion - TAKO_DESKTOP_VERSION from the checked-out source.
 * @returns The stable version without the `v` prefix.
 */
export function resolveTakoReleaseVersion(tag: string, sourceVersion: string): string

/**
 * Convert the codesigning identity reported by `security find-identity` into the packaging setting.
 * @param identity - Full identity name, `Developer ID Application: Name (TEAMID)`.
 * @param teamId - Apple Developer Team ID the notarization credentials belong to.
 * @returns The identity without the `Developer ID Application:` prefix.
 */
export function takoMacOSSigningIdentity(identity: string, teamId: string): string

/** Settings the signed macOS release build reads from `.env.macos`. */
export interface TakoMacOSReleaseSettings {
  signingIdentity: string
  teamId: string
  certificatePath: string
  certificatePassword: string
  appleId: string
  appleAppSpecificPassword: string
}

/**
 * Render the `.env.macos` file the official signed packaging path reads, notarizing with an Apple ID.
 * @param settings - Release signing settings.
 * @returns Dotenv text whose quoted values Node's parseEnv returns unchanged.
 */
export function renderTakoMacOSReleaseEnvironment(settings: TakoMacOSReleaseSettings): string

/**
 * Name the files one platform job publishes and the build directory that holds them.
 * @param target - Release target.
 * @param version - Application version.
 * @param mode - macOS signing mode; Windows releases are always unsigned.
 * @returns Directory relative to apps/desktop, file names, and the electron-updater metadata file among them.
 */
export function takoReleaseAssets(target: 'mac-arm64' | 'win-x64', version: string, mode: 'signed' | 'unsigned'): {
  directory: string
  files: string[]
  updateMetadata: string | undefined
}

/**
 * Read the file names an electron-updater metadata file refers to.
 * @param metadata - latest.yml or latest-mac.yml text.
 * @returns Declared version and every `url`/`path` entry.
 */
export function takoUpdateMetadataReferences(metadata: string): { version: string | undefined, files: string[] }

/**
 * Copy one platform's release files into a flat directory after checking they are complete and consistent.
 * @param request - Release target, signing mode, destination, and an optional apps/desktop root.
 * @returns Copied file names.
 */
export function collectTakoReleaseAssets(request: {
  target: 'mac-arm64' | 'win-x64'
  version: string
  mode: 'signed' | 'unsigned'
  output: string
  appRoot?: string
}): string[]

/**
 * Write SHA256SUMS.txt for every regular file in a release directory, in `sha256sum` format.
 * @param directory - Flat release asset directory.
 * @returns The checksum file contents.
 */
export function writeTakoReleaseChecksums(directory: string): string

/**
 * Render the GitHub Release notes from the maintained template.
 * @param template - .github/tako-release-notes.md text with {{VERSION}} and {{MAC_DOWNLOAD}} placeholders.
 * @param version - Application version.
 * @param macMode - Whether the macOS installer is signed and notarized.
 * @returns Release notes Markdown.
 */
export function renderTakoReleaseNotes(template: string, version: string, macMode: 'signed' | 'unsigned'): string

/**
 * Replace the release version in an asset name so the same artifact can be compared across releases.
 * @param name - Release asset name, for example `DSH-Tako-0.1.36-win-x64.exe`.
 * @returns The name with its version segment replaced by `<version>`.
 */
export function takoReleaseAssetRole(name: string): string

/** One artifact's size in two consecutive releases; `growth` is a fraction of the previous size. */
export interface TakoReleaseSizeRow {
  name: string
  previous: number | undefined
  current: number
  growth: number | undefined
}

/**
 * Compare the assets one release publishes against the same artifacts of the previous release.
 * @param previous - Assets of the previous release.
 * @param current - Assets about to be published.
 * @returns One row per current asset.
 */
export function compareTakoReleaseSizes(
  previous: { name: string, size: number }[],
  current: { name: string, size: number }[],
): TakoReleaseSizeRow[]

/**
 * Render the size comparison as release-log lines, warning when an artifact grew past the threshold.
 * @param rows - Comparison rows.
 * @param thresholdPercent - Growth percentage that counts as a regression.
 * @returns Report text and the artifacts that exceeded the threshold.
 */
export function renderTakoReleaseSizeReport(rows: TakoReleaseSizeRow[], thresholdPercent: number): { text: string, regressions: string[] }
