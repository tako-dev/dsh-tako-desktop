/** Read file-owned packaging settings without loading packaging dependencies. */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { parseEnv } from 'node:util'

const FILE_SETTINGS = ['DSH_DESKTOP_WINDOWS_CER_FILE', 'DSH_DESKTOP_WINDOWS_SIGNTOOL', 'APPLE_API_KEY', 'APPLE_KEYCHAIN', 'CSC_LINK']

/**
 * Read an explicitly selected dotenv without exposing credential-bearing parser errors.
 * @param {string} path Selected file; relative file settings resolve beside it.
 * @param {(name: string) => boolean} accepts Whether this file may declare a setting.
 * @returns {Record<string, string>} Validated file settings.
 */
export function readDesktopPackageSettings(path, accepts) {
  let contents
  try {
    contents = readFileSync(path, 'utf8')
  }
  catch {
    throw new Error(`desktop package: cannot read ${path}; copy ${path}.example and fill in the local settings`)
  }
  const settings = parseSettings(path, contents)
  for (const name of Object.keys(settings)) {
    if (!accepts(name)) {
      throw new Error(`desktop package: unsupported setting ${name} in ${path}; use the platform template`)
    }
  }
  for (const name of FILE_SETTINGS) {
    if (settings[name]?.trim()) settings[name] = resolve(dirname(path), settings[name].trim())
  }
  return settings
}

/**
 * Read only the settings an unsigned local build consumes from a dotenv that may not exist.
 * @param {string} path Optional file; other settings belong to signed packaging and are ignored.
 * @param {(name: string) => boolean} accepts Whether the local build consumes a setting.
 * @returns {Record<string, string>} Selected file settings, empty when the file is absent.
 */
export function readOptionalDesktopPackageSettings(path, accepts) {
  let contents
  try {
    contents = readFileSync(path, 'utf8')
  }
  catch (error) {
    if (error !== null && typeof error === 'object' && error.code === 'ENOENT') return {}
    throw error
  }
  const settings = parseSettings(path, contents)
  return Object.fromEntries(Object.entries(settings).filter(([name]) => accepts(name)))
}

/**
 * Parse dotenv contents and reject NUL values without exposing credential-bearing parser errors.
 * @param {string} path File that supplied the contents, reported only in error messages.
 * @param {string} contents Raw dotenv text; a UTF-8 BOM is stripped.
 * @returns {Record<string, string>} Parsed settings.
 */
function parseSettings(path, contents) {
  let settings
  try {
    settings = parseEnv(contents.replace(/^﻿/u, ''))
  }
  catch {
    // Parser diagnostics can contain credential-bearing input.
    throw new Error(`desktop package: invalid dotenv syntax in ${path}`)
  }
  for (const name of Object.keys(settings)) {
    if (settings[name].includes('\0')) throw new Error(`desktop package: ${name} cannot contain a NUL character`)
  }
  return settings
}
