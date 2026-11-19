/** Read file-owned packaging settings without loading packaging dependencies. */

/**
 * Read an explicitly selected dotenv without exposing credential-bearing parser errors.
 * @param path - Selected file; relative file settings resolve beside it.
 * @param accepts - Whether this file may declare a setting.
 * @returns Validated file settings.
 */
export function readDesktopPackageSettings(path: string, accepts: (name: string) => boolean): Record<string, string>

/**
 * Read only the settings an unsigned local build consumes from a dotenv that may not exist.
 * @param path - Optional file; other settings belong to signed packaging and are ignored.
 * @param accepts - Whether the local build consumes a setting.
 * @returns Selected file settings, empty when the file is absent.
 */
export function readOptionalDesktopPackageSettings(path: string, accepts: (name: string) => boolean): Record<string, string>
