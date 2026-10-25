/** Write and verify the updater configuration sealed into a macOS application. */

import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { dump, load } from 'js-yaml'

const CONFIG_FILENAME = 'app-update.yml'
import { resolveDesktopUpdateChannel } from './desktop-auto-update-environment.mjs'

function object(value, label) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`desktop macOS update config: ${label} must be an object`)
  }
  return value
}

function nonEmptyString(value, label) {
  if (typeof value !== 'string' || value === '') {
    throw new Error(`desktop macOS update config: ${label} must be a non-empty string`)
  }
  return value
}

/**
 * Resolve the one macOS feed from the final electron-builder configuration: the official generic
 * HTTPS feed, or the GitHub Releases feed DSH Tako publishes to.
 * @param {unknown} publish - Final electron-builder publish setting.
 * @returns {{ publicUrl: string, channel?: 'nightly' | 'latest' } | { provider: 'github', owner: string, repo: string, channel?: 'nightly' | 'latest' }} Resolved feed used by the packaged App.
 */
export function resolveMacOSAppUpdateFeed(publish) {
  if (!Array.isArray(publish) || publish.length !== 1) {
    throw new Error('desktop macOS update config: publish must contain exactly one provider')
  }
  const provider = object(publish[0], 'publish provider')
  if (!['generic', 'github'].includes(provider.provider) || !['nightly', 'latest'].includes(provider.channel)) {
    throw new Error('desktop macOS update config: publish provider must be generic or github with nightly or latest channel')
  }
  const channel = resolveDesktopUpdateChannel({ DSH_DESKTOP_UPDATE_CHANNEL: provider.channel })
  if (provider.provider === 'github') {
    return { provider: 'github', owner: nonEmptyString(provider.owner, 'publish provider owner'),
      repo: nonEmptyString(provider.repo, 'publish provider repo'), channel }
  }
  return { publicUrl: nonEmptyString(provider.url, 'publish provider URL'), channel }
}

/**
 * Create the electron-updater configuration embedded before code signing.
 * @param {{ publicUrl: string, channel?: 'nightly' | 'latest' } | { provider: 'github', owner: string, repo: string, channel?: 'nightly' | 'latest' }} update - Resolved update feed.
 * @param {string} updaterCacheDirName - electron-builder application cache directory.
 * @returns {object} Packaged updater fields.
 */
export function createMacOSAppUpdateConfig(update, updaterCacheDirName) {
  const channel = resolveDesktopUpdateChannel({ DSH_DESKTOP_UPDATE_CHANNEL: update.channel })
  const cache = nonEmptyString(updaterCacheDirName, 'updater cache directory')
  if ('provider' in update && update.provider === 'github') {
    return {
      provider: 'github',
      owner: nonEmptyString(update.owner, 'owner'),
      repo: nonEmptyString(update.repo, 'repo'),
      channel,
      updaterCacheDirName: cache,
    }
  }
  return {
    provider: 'generic',
    url: nonEmptyString(update.publicUrl, 'public URL'),
    channel,
    updaterCacheDirName: cache,
  }
}

/**
 * Write the updater configuration into an assembled App before signing.
 * @param {string} resourcesDir - App Contents/Resources directory.
 * @param {object} update - Resolved update feed.
 * @param {string} updaterCacheDirName - electron-builder application cache directory.
 * @returns {Promise<void>} Resolves after the configuration is durable.
 */
export async function writeMacOSAppUpdateConfig(resourcesDir, update, updaterCacheDirName) {
  const config = createMacOSAppUpdateConfig(update, updaterCacheDirName)
  await writeFile(join(resourcesDir, CONFIG_FILENAME), dump(config, { lineWidth: -1, noRefs: true }))
}

/**
 * Verify the updater configuration inside an assembled macOS App.
 * @param {string} appPath - Application bundle path.
 * @param {object} update - Expected update feed.
 * @param {string | undefined} updaterCacheDirName - Exact cache directory when known.
 * @returns {Promise<void>} Resolves when the packaged configuration matches the release destination.
 */
export async function verifyMacOSAppUpdateConfig(appPath, update, updaterCacheDirName = undefined) {
  const path = join(appPath, 'Contents', 'Resources', CONFIG_FILENAME)
  let parsed
  try {
    parsed = load(await readFile(path, 'utf8'))
  }
  catch (error) {
    throw new Error(`desktop macOS update config: cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`)
  }
  const config = object(parsed, CONFIG_FILENAME)
  const expected = createMacOSAppUpdateConfig(update, typeof config.updaterCacheDirName === 'string' && config.updaterCacheDirName !== ''
    ? config.updaterCacheDirName : 'unknown')
  const feedFields = expected.provider === 'github' ? ['provider', 'owner', 'repo', 'channel'] : ['provider', 'url', 'channel']
  if (feedFields.some(field => config[field] !== expected[field])) {
    const destination = expected.provider === 'github' ? `github:${expected.owner}/${expected.repo}` : expected.url
    throw new Error(`desktop macOS update config: ${path} does not match ${destination}`)
  }
  const actualCacheDirName = nonEmptyString(config.updaterCacheDirName, `${CONFIG_FILENAME}.updaterCacheDirName`)
  if (updaterCacheDirName !== undefined && actualCacheDirName !== updaterCacheDirName) {
    throw new Error(`desktop macOS update config: ${path} has updater cache directory ${actualCacheDirName}; expected ${updaterCacheDirName}`)
  }
}
