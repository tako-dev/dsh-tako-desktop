/** Product name: bundle/executable name, macOS menu name, and Electron's userData directory. */
export const TAKO_DESKTOP_PRODUCT_NAME: 'DSH Tako'
/** Default reverse-DNS application identifier when DSH_DESKTOP_APP_ID is unset. */
export const TAKO_DESKTOP_APP_ID: 'tech.shiroha.dsh-tako'
/** The official Desktop identifier; a DSH Tako build must never reuse it. */
export const OFFICIAL_DESKTOP_APP_ID: 'com.deepseek.harness'
/** OS-level URL scheme registered by the packaged application. */
export const TAKO_DESKTOP_PROTOCOL: 'dsh-tako'
/** Installer and archive file-name prefix. */
export const TAKO_DESKTOP_ARTIFACT_PREFIX: 'DSH-Tako'
/** Packaged package.json name; electron-builder derives the updater cache directory from it. */
export const TAKO_DESKTOP_PACKAGE_NAME: 'dsh-tako-desktop'
/** Desktop application version, independent of the bundled DSH runtime version. */
export const TAKO_DESKTOP_VERSION: string
/** Environment override for one build's application version. */
export const TAKO_DESKTOP_VERSION_ENV: 'DSH_TAKO_DESKTOP_VERSION'
/** GitHub Releases feed that electron-updater reads. */
export const TAKO_DESKTOP_GITHUB_PUBLISH: Readonly<{ provider: 'github'; owner: 'tako-dev'; repo: 'dsh-tako-desktop' }>

/**
 * Resolve the application version one build publishes.
 * @param env - Packaging environment.
 * @returns Strict semver application version.
 */
export function resolveTakoDesktopVersion(env?: NodeJS.ProcessEnv): string

/**
 * Resolve the update channel embedded in a DSH Tako build.
 * @param env - Packaging environment.
 * @returns Validated channel; `latest` when unset.
 */
export function resolveTakoDesktopUpdateChannel(env?: NodeJS.ProcessEnv): 'nightly' | 'latest'

/**
 * The electron-builder publish entry for a signed DSH Tako build.
 * @param channel - Embedded update channel.
 * @returns Publish provider.
 */
export function takoDesktopPublish(channel: 'nightly' | 'latest'): {
  provider: 'github'; owner: 'tako-dev'; repo: 'dsh-tako-desktop'; channel: 'nightly' | 'latest'
}
