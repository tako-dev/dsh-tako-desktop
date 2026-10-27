/**
 * DSH Tako runtime identity. The packaged product name (and so Electron's userData directory and
 * single-instance lock) comes from electron-builder; see scripts/tako-desktop-identity.mjs. The
 * values here keep the remaining machine-wide resources apart from the official DSH Desktop.
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import { TAKO_DESKTOP_VERSION } from '../scripts/tako-desktop-identity.mjs'

/** Product name shown in the About panel and menus. */
export const TAKO_DESKTOP_PRODUCT_NAME = 'DSH Tako'

/** OS-level URL scheme; the official Desktop owns `dsh`. */
export const TAKO_DESKTOP_PROTOCOL = 'dsh-tako'

/** Terminal command name: macOS `/usr/local/bin/dsh-tako`, Windows `dsh-tako.cmd`. The official CLI owns `dsh`. */
export const TAKO_CLI_COMMAND = 'dsh-tako'

/** macOS command link the command manager installs. */
export const TAKO_CLI_COMMAND_DESTINATION = `/usr/local/bin/${TAKO_CLI_COMMAND}`

/** Harness home directory name used when DSH_HOME is not set. */
export const TAKO_DSH_HOME_DIR_NAME = '.dsh-tako'

/** Attribution shown beside the product name. */
export const TAKO_DESKTOP_ATTRIBUTION = 'Built on DeepSeek Harness (MIT). Not an official DeepSeek product.'

/**
 * Give DSH Tako its own Harness home unless the launch environment chose one, so its profile lock,
 * settings, sessions, and credentials file never collide with the official DSH Desktop or CLI.
 * @param env - Process environment, mutated before any path is resolved and inherited by the Host.
 * @param home - User home directory.
 * @returns The Harness home in effect.
 */
export function applyTakoDesktopHome(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  const configured = env.DSH_HOME?.trim()
  if (configured !== undefined && configured !== '') return configured
  const selected = join(home, TAKO_DSH_HOME_DIR_NAME)
  env.DSH_HOME = selected
  return selected
}

/**
 * Whether an `open-url` event asks to bring DSH Tako to the foreground.
 * @param url - URL delivered by the operating system.
 * @returns True for `dsh-tako://open`.
 */
export function isTakoOpenUrl(url: string): boolean {
  return url === `${TAKO_DESKTOP_PROTOCOL}://open` || url === `${TAKO_DESKTOP_PROTOCOL}://open/`
}

/**
 * Replace the official product suffix the shared Web client puts in its document title.
 * @param title - Title the page requested.
 * @returns The title with the DSH Tako product name.
 */
export function takoWindowTitle(title: string): string {
  const trimmed = title.replace(/(?:DeepSeek Harness|DSH Local Build)$/u, TAKO_DESKTOP_PRODUCT_NAME)
  return trimmed === '' ? TAKO_DESKTOP_PRODUCT_NAME : trimmed
}

/**
 * Packaged DSH Tako application version, not the DSH kernel.
 * Unpackaged Electron `app.getVersion()` is apps/desktop/package.json (the kernel).
 * @param app - Electron application.
 * @returns The product version electron-updater publishes.
 */
export function takoDesktopProductVersion(app: { isPackaged: boolean; getVersion(): string }): string {
  return app.isPackaged ? app.getVersion() : TAKO_DESKTOP_VERSION
}
