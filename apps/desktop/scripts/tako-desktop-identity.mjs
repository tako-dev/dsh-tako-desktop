/**
 * DSH Tako build identity: everything that makes the packaged application a
 * separate product from the official DeepSeek Harness Desktop, so both can be
 * installed side by side. Runtime counterparts live in src/tako-identity.ts.
 */

import { valid } from 'semver'

/** Product name: bundle/executable name, macOS menu name, and Electron's userData directory. */
export const TAKO_DESKTOP_PRODUCT_NAME = 'DSH Tako'

/** Default reverse-DNS application identifier when DSH_DESKTOP_APP_ID is unset. */
export const TAKO_DESKTOP_APP_ID = 'tech.shiroha.dsh-tako'

/** The official Desktop identifier; a DSH Tako build must never reuse it. */
export const OFFICIAL_DESKTOP_APP_ID = 'com.deepseek.harness'

/** OS-level URL scheme registered by the packaged application (the official one owns `dsh`). */
export const TAKO_DESKTOP_PROTOCOL = 'dsh-tako'

/** Terminal command the Desktop installs (macOS link name, Windows `.cmd` launcher); the official CLI owns `dsh`. */
export const TAKO_DESKTOP_CLI_COMMAND = 'dsh-tako'

/** Installer and archive file-name prefix. */
export const TAKO_DESKTOP_ARTIFACT_PREFIX = 'DSH-Tako'

/** Packaged package.json name; electron-builder derives the updater cache directory from it. */
export const TAKO_DESKTOP_PACKAGE_NAME = 'dsh-tako-desktop'

/**
 * Desktop application version, independent of the bundled DSH runtime version
 * (apps/desktop/package.json keeps the official version, which the runtime tree
 * and workspace checks compare against).
 */
export const TAKO_DESKTOP_VERSION = '0.1.33'

/** Environment override for one build's application version, e.g. from a release tag. */
export const TAKO_DESKTOP_VERSION_ENV = 'DSH_TAKO_DESKTOP_VERSION'

/**
 * Packaging environment flag ('1') for a DSH Tako Windows release without code signing: the build skips
 * Authenticode like `--unsigned`, but embeds the GitHub Releases update feed and uses release artifact
 * names without the `-unsigned` marker. electron-updater verifies no publisher for such a build.
 * macOS never uses it, because Squirrel.Mac refuses to install updates into an application without a
 * Developer ID signature.
 */
export const TAKO_UNSIGNED_RELEASE_ENV = 'DSH_TAKO_UNSIGNED_RELEASE'

/**
 * Whether a packaging environment selects the unsigned Windows release mode.
 * @param {NodeJS.ProcessEnv} env - Packaging environment.
 * @returns {boolean} True when {@link TAKO_UNSIGNED_RELEASE_ENV} is `1`.
 */
export function isTakoUnsignedRelease(env = process.env) {
  const value = env[TAKO_UNSIGNED_RELEASE_ENV]
  if (value !== undefined && value !== '0' && value !== '1') throw new Error(`desktop package: ${TAKO_UNSIGNED_RELEASE_ENV} must be 0 or 1`)
  return value === '1'
}

/** GitHub Releases feed that electron-updater reads; never the official update origin. */
export const TAKO_DESKTOP_GITHUB_PUBLISH = Object.freeze({ provider: 'github', owner: 'tako-dev', repo: 'dsh-tako-desktop' })

/**
 * Resolve the application version one build publishes.
 * @param {NodeJS.ProcessEnv} env - Packaging environment.
 * @returns {string} Strict semver application version.
 */
export function resolveTakoDesktopVersion(env = process.env) {
  const requested = env[TAKO_DESKTOP_VERSION_ENV]?.trim() || TAKO_DESKTOP_VERSION
  const version = valid(requested)
  if (version === null || version !== requested) {
    throw new Error(`desktop package: ${TAKO_DESKTOP_VERSION_ENV} must be a strict semantic version`)
  }
  return version
}

/**
 * Resolve the update channel embedded in a DSH Tako build; GitHub Releases publish stable `latest` by default.
 * @param {NodeJS.ProcessEnv} env - Packaging environment.
 * @returns {'nightly' | 'latest'} Validated channel.
 */
export function resolveTakoDesktopUpdateChannel(env = process.env) {
  const channel = env.DSH_DESKTOP_UPDATE_CHANNEL || 'latest'
  if (channel !== 'nightly' && channel !== 'latest') throw new Error('desktop auto-update: invalid update channel')
  return channel
}

/**
 * The electron-builder publish entry for a signed DSH Tako build.
 * @param {'nightly' | 'latest'} channel - Embedded update channel.
 * @returns {{ provider: 'github', owner: string, repo: string, channel: 'nightly' | 'latest' }} Publish provider.
 */
export function takoDesktopPublish(channel) {
  return { ...TAKO_DESKTOP_GITHUB_PUBLISH, channel }
}
