/**
 * DSH Tako GitHub Release steps for .github/workflows/release.yml. The module uses only Node.js
 * built-ins, so the release planning and publication jobs run it without installing the workspace.
 * Every command writes GitHub step outputs to GITHUB_OUTPUT when that file is set and never prints
 * credential values.
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, copyFileSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

const APP_ROOT = resolve(import.meta.dirname, '..')
const IDENTITY_SOURCE = join(APP_ROOT, 'scripts', 'tako-desktop-identity.mjs')
const ARTIFACT_PREFIX = 'DSH-Tako'
const STABLE_VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u
const DEVELOPER_ID_PREFIX = 'Developer ID Application: '

/**
 * Read the DSH Tako application version constant from the identity module source without loading its dependencies.
 * @param {string} source - Text of scripts/tako-desktop-identity.mjs.
 * @returns {string} The TAKO_DESKTOP_VERSION literal.
 */
export function readTakoDesktopVersionSource(source) {
  const matches = [...source.matchAll(/^export const TAKO_DESKTOP_VERSION = '([^']+)'$/gmu)]
  if (matches.length !== 1) throw new Error('tako release: tako-desktop-identity.mjs must declare exactly one TAKO_DESKTOP_VERSION string literal')
  return matches[0][1]
}

/**
 * Resolve the application version a release tag publishes and require it to equal the source version.
 * GitHub Releases feed the `latest` update channel, which electron-builder accepts only for stable versions.
 * @param {string} tag - Git tag, for example `v0.1.0`.
 * @param {string} sourceVersion - TAKO_DESKTOP_VERSION from the checked-out source.
 * @returns {string} The version without the `v` prefix.
 */
export function resolveTakoReleaseVersion(tag, sourceVersion) {
  const match = /^v(.+)$/u.exec(tag)
  if (match === null) throw new Error(`tako release: tag ${JSON.stringify(tag)} must be v<version>, for example v${sourceVersion}`)
  const version = match[1]
  if (!STABLE_VERSION.test(version)) {
    throw new Error(`tako release: tag ${tag} must name a stable MAJOR.MINOR.PATCH version; the latest update channel rejects prereleases`)
  }
  if (version !== sourceVersion) {
    throw new Error(`tako release: tag ${tag} does not match TAKO_DESKTOP_VERSION ${sourceVersion} in apps/desktop/scripts/tako-desktop-identity.mjs; change the constant, commit, and tag that commit`)
  }
  return version
}

/**
 * Convert the codesigning identity reported by `security find-identity` into the packaging setting.
 * @param {string} identity - Full identity name, `Developer ID Application: Name (TEAMID)`.
 * @param {string} teamId - Apple Developer Team ID the notarization credentials belong to.
 * @returns {string} The identity without the `Developer ID Application:` prefix, as DSH_DESKTOP_MACOS_SIGNING_IDENTITY expects.
 */
export function takoMacOSSigningIdentity(identity, teamId) {
  const trimmed = identity.trim()
  if (!trimmed.startsWith(DEVELOPER_ID_PREFIX)) throw new Error('tako release: the certificate must contain a "Developer ID Application" identity')
  const name = trimmed.slice(DEVELOPER_ID_PREFIX.length)
  if (!name.endsWith(` (${teamId})`)) throw new Error('tako release: the Developer ID Application certificate does not belong to APPLE_TEAM_ID')
  return name
}

function dotenvValue(name, value) {
  if (value.includes('\0') || value.includes('\n') || value.includes('\r')) throw new Error(`tako release: ${name} cannot contain NUL or line breaks`)
  const quote = ["'", '"', '`'].find(candidate => !value.includes(candidate))
  if (quote === undefined) throw new Error(`tako release: ${name} cannot contain all three quote characters`)
  return `${name}=${quote}${value}${quote}`
}

/**
 * Render the `.env.macos` file the official signed packaging path reads, notarizing with an Apple ID.
 * @param {{ signingIdentity: string, teamId: string, certificatePath: string, certificatePassword: string, appleId: string, appleAppSpecificPassword: string }} settings - Release signing settings.
 * @returns {string} Dotenv text; every value is quoted so Node's parseEnv returns it unchanged.
 */
export function renderTakoMacOSReleaseEnvironment(settings) {
  return `${[
    '# Written by the DSH Tako release workflow; never commit this file.',
    dotenvValue('DSH_DESKTOP_APP_ID', 'tech.shiroha.dsh-tako'),
    dotenvValue('DSH_DESKTOP_MACOS_SIGNING_IDENTITY', settings.signingIdentity),
    dotenvValue('DSH_DESKTOP_MACOS_TEAM_ID', settings.teamId),
    dotenvValue('CSC_LINK', settings.certificatePath),
    dotenvValue('CSC_KEY_PASSWORD', settings.certificatePassword),
    dotenvValue('APPLE_ID', settings.appleId),
    dotenvValue('APPLE_APP_SPECIFIC_PASSWORD', settings.appleAppSpecificPassword),
    dotenvValue('APPLE_TEAM_ID', settings.teamId),
  ].join('\n')}\n`
}

/**
 * Replace the release version in an asset name so the same artifact can be compared across releases.
 * @param {string} name - Release asset name, for example `DSH-Tako-0.1.36-win-x64.exe`.
 * @returns {string} The name with its version segment replaced by `<version>`.
 */
export function takoReleaseAssetRole(name) {
  return name.replace(/\d+\.\d+\.\d+/gu, '<version>')
}

/**
 * Compare the assets one release publishes against the same artifacts of the previous release.
 * @param {{ name: string, size: number }[]} previous - Assets of the previous release.
 * @param {{ name: string, size: number }[]} current - Assets about to be published.
 * @returns {{ name: string, previous: number | undefined, current: number, growth: number | undefined }[]} One row per current asset.
 */
export function compareTakoReleaseSizes(previous, current) {
  const sizes = new Map(previous.map(asset => [takoReleaseAssetRole(asset.name), asset.size]))
  return current.map(asset => {
    const size = sizes.get(takoReleaseAssetRole(asset.name))
    return {
      name: asset.name,
      previous: size,
      current: asset.size,
      growth: size === undefined || size === 0 ? undefined : (asset.size - size) / size,
    }
  })
}

/**
 * Render the size comparison as release-log lines, warning when an artifact grew past the threshold.
 * @param {{ name: string, previous: number | undefined, current: number, growth: number | undefined }[]} rows - Comparison rows.
 * @param {number} thresholdPercent - Growth percentage that counts as a regression.
 * @returns {{ text: string, regressions: string[] }} Report text and the artifacts that exceeded the threshold.
 */
export function renderTakoReleaseSizeReport(rows, thresholdPercent) {
  const megabytes = bytes => `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  const lines = ['release artifact sizes against the previous release:']
  const regressions = []
  for (const row of rows) {
    const growth = row.growth === undefined ? 'new' : `${row.growth >= 0 ? '+' : ''}${(row.growth * 100).toFixed(1)}%`
    const previous = row.previous === undefined ? '     -' : megabytes(row.previous).padStart(9)
    lines.push(`  ${previous} -> ${megabytes(row.current).padStart(9)}  ${growth.padStart(7)}  ${row.name}`)
    if (row.growth !== undefined && row.growth * 100 > thresholdPercent) regressions.push(`${row.name} ${growth}`)
  }
  if (regressions.length > 0) {
    lines.push(`::warning title=Release artifact grew past ${thresholdPercent}%::${regressions.join('; ')}`)
  }
  return { text: `${lines.join('\n')}\n`, regressions }
}

/**
 * Name the files one platform job publishes and the build directory that holds them.
 * @param {'mac-arm64' | 'win-x64'} target - Release target.
 * @param {string} version - Application version.
 * @param {'signed' | 'unsigned'} mode - macOS signing mode; Windows releases are always unsigned.
 * @returns {{ directory: string, files: string[], updateMetadata: string | undefined }} Directory relative to apps/desktop, file names, and the electron-updater metadata file among them.
 */
export function takoReleaseAssets(target, version, mode) {
  const base = `${ARTIFACT_PREFIX}-${version}`
  if (target === 'win-x64') {
    return { directory: '.desktop-build/targets/win-x64/unsigned-artifacts',
      files: [`${base}-win-x64.exe`, `${base}-win-x64.exe.blockmap`, 'latest.yml'], updateMetadata: 'latest.yml' }
  }
  if (target !== 'mac-arm64') throw new Error(`tako release: unsupported target ${String(target)}`)
  if (mode === 'unsigned') {
    return { directory: '.desktop-build/targets/mac-arm64/unsigned-artifacts', files: [`${base}-mac-arm64-unsigned.dmg`], updateMetadata: undefined }
  }
  return { directory: '.desktop-build/targets/mac-arm64/artifacts',
    files: [`${base}-mac-arm64.dmg`, `${base}-mac-arm64.zip`, `${base}-mac-arm64.zip.blockmap`, 'latest-mac.yml'],
    updateMetadata: 'latest-mac.yml' }
}

/**
 * Read the file names an electron-updater metadata file refers to.
 * @param {string} metadata - latest.yml or latest-mac.yml text.
 * @returns {{ version: string | undefined, files: string[] }} Declared version and every `url`/`path` entry.
 */
export function takoUpdateMetadataReferences(metadata) {
  const version = /^version:\s*['"]?([^'"\s]+)['"]?\s*$/mu.exec(metadata)?.[1]
  const files = [...metadata.matchAll(/^\s*(?:-\s+)?(?:url|path):\s*['"]?([^'"\n]+?)['"]?\s*$/gmu)].map(match => match[1])
  return { version, files: [...new Set(files)] }
}

/**
 * Copy one platform's release files into a flat directory after checking they are complete and consistent.
 * @param {{ target: 'mac-arm64' | 'win-x64', version: string, mode: 'signed' | 'unsigned', output: string, appRoot?: string }} request - Release target and destination.
 * @returns {string[]} Copied file names.
 */
export function collectTakoReleaseAssets(request) {
  const assets = takoReleaseAssets(request.target, request.version, request.mode)
  const source = join(request.appRoot ?? APP_ROOT, assets.directory)
  for (const file of assets.files) {
    let size = 0
    try { size = statSync(join(source, file)).size } catch (error) {
      // A missing file is reported below together with an empty one.
      if (error?.code !== 'ENOENT') throw error
    }
    if (size === 0) throw new Error(`tako release: missing or empty release file ${join(assets.directory, file)}`)
  }
  if (assets.updateMetadata !== undefined) {
    const references = takoUpdateMetadataReferences(readFileSync(join(source, assets.updateMetadata), 'utf8'))
    if (references.version !== request.version) {
      throw new Error(`tako release: ${assets.updateMetadata} declares version ${String(references.version)} instead of ${request.version}`)
    }
    const unknown = references.files.filter(file => !assets.files.includes(file))
    if (references.files.length === 0 || unknown.length > 0) {
      throw new Error(`tako release: ${assets.updateMetadata} must refer only to published files; unexpected ${JSON.stringify(unknown)}`)
    }
  }
  mkdirSync(request.output, { recursive: true })
  for (const file of assets.files) copyFileSync(join(source, file), join(request.output, file))
  return assets.files
}

/**
 * Write SHA256SUMS.txt for every regular file in a release directory, in `sha256sum` format.
 * @param {string} directory - Flat release asset directory.
 * @returns {string} The checksum file contents.
 */
export function writeTakoReleaseChecksums(directory) {
  const files = readdirSync(directory).filter(name => name !== 'SHA256SUMS.txt' && statSync(join(directory, name)).isFile()).sort()
  if (files.length === 0) throw new Error('tako release: no release files to checksum')
  const text = files.map(name => `${createHash('sha256').update(readFileSync(join(directory, name))).digest('hex')}  ${name}\n`).join('')
  writeFileSync(join(directory, 'SHA256SUMS.txt'), text)
  return text
}

/**
 * Render the GitHub Release notes from the maintained template.
 * @param {string} template - .github/tako-release-notes.md text with {{VERSION}} and {{MAC_DOWNLOAD}} placeholders.
 * @param {string} version - Application version.
 * @param {'signed' | 'unsigned'} macMode - Whether the macOS installer is signed and notarized.
 * @param {string} [details] - Version-specific changes and exact build sources.
 * @returns {string} Release notes Markdown.
 */
export function renderTakoReleaseNotes(template, version, macMode, details = '') {
  const base = `${ARTIFACT_PREFIX}-${version}`
  const mac = macMode === 'signed'
    ? `\`${base}-mac-arm64.dmg\` — Apple Silicon，已签名并公证 / signed and notarized`
    : `\`${base}-mac-arm64-unsigned.dmg\` — Apple Silicon，**未签名**：首次打开需在“系统设置 → 隐私与安全性”中点“仍要打开”，且不会自动更新 / **unsigned**: approve it under System Settings → Privacy & Security; no automatic updates`
  const rendered = template.replaceAll('{{VERSION}}', version).replaceAll('{{MAC_DOWNLOAD}}', mac)
    .replaceAll('{{RELEASE_DETAILS}}', details)
  if (/\{\{[A-Z_]+\}\}/u.test(rendered)) throw new Error('tako release: the release notes template has an unknown placeholder')
  return rendered
}

/**
 * Request GitHub's version-specific PR/changelog summary for the exact built commit.
 * Failures stop publication instead of producing a release with missing change sources.
 * @param {{ repository: string, version: string, commit: string, runtimeVersion: string }} source - Checked-out release identity.
 * @param {typeof fetch} [fetchImpl] - HTTP implementation for isolated tests.
 * @returns {Promise<string>} Change summary and source references, without credentials.
 */
export async function generateTakoReleaseDetails(source, fetchImpl = fetch) {
  if (!/^[\w.-]+\/[\w.-]+$/u.test(source.repository)
    || !STABLE_VERSION.test(source.version) || !/^[a-f\d]{40}$/u.test(source.commit)
    || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/u.test(source.runtimeVersion)) {
    throw new Error('tako release: invalid release source identity')
  }
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN
  const headers = { accept: 'application/vnd.github+json', 'content-type': 'application/json', 'user-agent': 'dsh-tako-release',
    ...(token ? { authorization: `Bearer ${token}` } : {}) }
  const response = await fetchImpl(`https://api.github.com/repos/${source.repository}/releases/generate-notes`, {
    method: 'POST', headers, redirect: 'error', signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({ tag_name: `v${source.version}`, target_commitish: source.commit }),
  })
  if (!response.ok) throw new Error(`tako release: change summary request failed with ${String(response.status)}`)
  const generated = await response.json()
  if (typeof generated?.body !== 'string' || generated.body.trim() === '') {
    throw new Error('tako release: GitHub returned no version-specific change summary')
  }
  const repositoryUrl = `https://github.com/${source.repository}`
  return [
    '## 本次变更与来源 / Changes and sources', '', generated.body.trim(), '',
    `- Tako 源码 / Source: [v${source.version}](${repositoryUrl}/tree/${source.commit}) · [commit ${source.commit.slice(0, 12)}](${repositoryUrl}/commit/${source.commit})`,
    `- 内置 DSH / Bundled runtime: **${source.runtimeVersion}** · [构建时版本 / build manifest](${repositoryUrl}/blob/${source.commit}/package.json) · [上游项目 / upstream](https://github.com/deepseek-ai/deepseek-harness)`,
    '',
  ].join('\n')
}

/** Regular-file sizes in one flat release directory, ignoring the checksum file it will regenerate. */
function releaseDirectorySizes(directory) {
  return readdirSync(directory)
    .filter(name => name !== 'SHA256SUMS.txt' && statSync(join(directory, name)).isFile())
    .map(name => ({ name, size: statSync(join(directory, name)).size }))
}

/**
 * Assets of the most recent published release other than the one being built.
 * @param {string} repository - `owner/repo` from GH_REPO.
 * @param {string} tag - Tag being released, excluded from the comparison.
 * @returns {Promise<{ name: string, size: number }[]>} Previous assets, or an empty list for a first release.
 */
async function previousReleaseAssets(repository, tag) {
  const headers = { accept: 'application/vnd.github+json', 'user-agent': 'dsh-tako-release' }
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN
  if (token !== undefined && token !== '') headers.authorization = `Bearer ${token}`
  const response = await fetch(`https://api.github.com/repos/${repository}/releases?per_page=20`, { headers })
  if (!response.ok) throw new Error(`tako release: GitHub released list failed with ${String(response.status)}`)
  const releases = await response.json()
  const previous = releases.find(release => release.draft !== true && release.tag_name !== tag)
  if (previous === undefined) return []
  return previous.assets.map(asset => ({ name: asset.name, size: asset.size }))
}

function output(values) {
  const file = process.env.GITHUB_OUTPUT
  const lines = Object.entries(values).map(([name, value]) => `${name}=${value}\n`).join('')
  if (file) appendFileSync(file, lines)
  else process.stdout.write(lines)
}

function requiredEnvironment(name) {
  const value = process.env[name]
  if (value === undefined || value === '') throw new Error(`tako release: ${name} must be set`)
  return value
}

async function main(argv) {
  const [command, ...rest] = argv
  const { values } = parseArgs({ args: rest, allowPositionals: false, options: {
    tag: { type: 'string' }, target: { type: 'string' }, version: { type: 'string' }, mode: { type: 'string' },
    output: { type: 'string' }, directory: { type: 'string' }, template: { type: 'string' },
    threshold: { type: 'string' },
  } })
  const mode = values.mode === 'unsigned' ? 'unsigned' : 'signed'
  if (values.mode !== undefined && values.mode !== 'signed' && values.mode !== 'unsigned') throw new Error('tako release: --mode must be signed or unsigned')
  switch (command) {
    case 'plan': {
      const version = resolveTakoReleaseVersion(values.tag ?? '', readTakoDesktopVersionSource(readFileSync(IDENTITY_SOURCE, 'utf8')))
      output({ version })
      return
    }
    case 'macos-env': {
      const environmentFile = values.output ?? join(APP_ROOT, '.env.macos')
      const teamId = requiredEnvironment('APPLE_TEAM_ID')
      writeFileSync(environmentFile, renderTakoMacOSReleaseEnvironment({
        signingIdentity: takoMacOSSigningIdentity(requiredEnvironment('TAKO_MACOS_SIGNING_IDENTITY'), teamId),
        teamId,
        certificatePath: requiredEnvironment('TAKO_MACOS_CERTIFICATE_PATH'),
        certificatePassword: process.env.APPLE_CERTIFICATE_PASSWORD ?? '',
        appleId: requiredEnvironment('APPLE_ID'),
        appleAppSpecificPassword: requiredEnvironment('APPLE_PASSWORD'),
      }), { mode: 0o600 })
      process.stdout.write(`tako release: wrote ${basename(environmentFile)} for the signed macOS build\n`)
      return
    }
    case 'collect': {
      if (values.target !== 'mac-arm64' && values.target !== 'win-x64') throw new Error('tako release: --target must be mac-arm64 or win-x64')
      const files = collectTakoReleaseAssets({ target: values.target, version: values.version ?? '', mode, output: values.output ?? '' })
      process.stdout.write(`tako release: collected ${files.join(', ')}\n`)
      return
    }
    case 'checksums':
      process.stdout.write(writeTakoReleaseChecksums(values.directory ?? ''))
      return
    case 'notes': {
      const repositoryRoot = resolve(APP_ROOT, '..', '..')
      const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' }).trim()
      // git show works in the publication job's sparse checkout without loading runtime code.
      const manifest = JSON.parse(execFileSync('git', ['show', 'HEAD:package.json'], { cwd: repositoryRoot, encoding: 'utf8' }))
      const details = await generateTakoReleaseDetails({
        repository: requiredEnvironment('GH_REPO'), version: values.version ?? '', commit, runtimeVersion: manifest.version,
      })
      writeFileSync(values.output ?? '', renderTakoReleaseNotes(readFileSync(values.template ?? '', 'utf8'), values.version ?? '', mode, details))
      return
    }
    case 'size': {
      const threshold = Number(values.threshold ?? '5')
      if (!Number.isFinite(threshold) || threshold < 0) throw new Error('tako release: --threshold must be a non-negative number')
      const rows = compareTakoReleaseSizes(
        await previousReleaseAssets(requiredEnvironment('GH_REPO'), values.tag ?? ''),
        releaseDirectorySizes(values.directory ?? ''),
      )
      const report = renderTakoReleaseSizeReport(rows, threshold)
      process.stdout.write(report.text)
      const summary = process.env.GITHUB_STEP_SUMMARY
      if (summary !== undefined && summary !== '') appendFileSync(summary, `### Release artifact sizes\n\n\`\`\`\n${report.text}\`\`\`\n`)
      return
    }
    default:
      throw new Error('tako release: expected plan, macos-env, collect, checksums, notes, or size')
  }
}

if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) {
  try { await main(process.argv.slice(2)) } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
