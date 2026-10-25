import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseEnv } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import {
  collectTakoReleaseAssets,
  readTakoDesktopVersionSource,
  renderTakoMacOSReleaseEnvironment,
  renderTakoReleaseNotes,
  resolveTakoReleaseVersion,
  takoMacOSSigningIdentity,
  takoReleaseAssets,
  takoUpdateMetadataReferences,
  writeTakoReleaseChecksums,
} from '../scripts/tako-release.mjs'
import { TAKO_DESKTOP_ARTIFACT_PREFIX, TAKO_DESKTOP_VERSION } from '../scripts/tako-desktop-identity.mjs'
import { desktopArtifactOutput, desktopTargetBuildPaths } from '../scripts/desktop-build-paths.mjs'

const APP_ROOT = resolve(import.meta.dirname, '..')
const REPOSITORY_ROOT = resolve(APP_ROOT, '..', '..')
const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function temporary(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-tako-release-'))
  roots.push(root)
  return root
}

describe('release version', () => {
  it('reads the same version the identity module exports', () => {
    const source = readFileSync(join(APP_ROOT, 'scripts/tako-desktop-identity.mjs'), 'utf8')
    expect(readTakoDesktopVersionSource(source)).toBe(TAKO_DESKTOP_VERSION)
    expect(() => readTakoDesktopVersionSource('export const OTHER = 1\n')).toThrow('exactly one TAKO_DESKTOP_VERSION')
  })

  it('requires a v-prefixed stable tag equal to the source version', () => {
    expect(resolveTakoReleaseVersion('v0.1.0', '0.1.0')).toBe('0.1.0')
    expect(() => resolveTakoReleaseVersion('0.1.0', '0.1.0')).toThrow('must be v<version>')
    expect(() => resolveTakoReleaseVersion('v0.1.1', '0.1.0')).toThrow('does not match TAKO_DESKTOP_VERSION 0.1.0')
    expect(() => resolveTakoReleaseVersion('v0.2.0-beta.1', '0.2.0-beta.1')).toThrow('stable MAJOR.MINOR.PATCH')
    expect(() => resolveTakoReleaseVersion('v01.0.0', '01.0.0')).toThrow('stable MAJOR.MINOR.PATCH')
  })
})

describe('macOS signing settings', () => {
  it('strips the Developer ID prefix and checks the team', () => {
    expect(takoMacOSSigningIdentity('Developer ID Application: Example Co., Ltd. (TEAMID1234)\n', 'TEAMID1234'))
      .toBe('Example Co., Ltd. (TEAMID1234)')
    expect(() => takoMacOSSigningIdentity('Apple Development: Someone (TEAMID1234)', 'TEAMID1234')).toThrow('Developer ID Application')
    expect(() => takoMacOSSigningIdentity('Developer ID Application: Example (OTHERTEAM1)', 'TEAMID1234')).toThrow('APPLE_TEAM_ID')
  })

  it('writes dotenv values that parse back unchanged, including quotes, hashes, and spaces', () => {
    const settings = {
      signingIdentity: 'Example "Quoted" Co. (TEAMID1234)', teamId: 'TEAMID1234', certificatePath: '/runner/temp/certificate.p12',
      certificatePassword: 'pa\'ss "word" # with spaces', appleId: 'release@example.com', appleAppSpecificPassword: 'abcd-efgh-ijkl-mnop',
    }
    const parsed = parseEnv(renderTakoMacOSReleaseEnvironment(settings))
    expect(parsed).toEqual({
      DSH_DESKTOP_APP_ID: 'tech.shiroha.dsh-tako', DSH_DESKTOP_MACOS_SIGNING_IDENTITY: settings.signingIdentity,
      DSH_DESKTOP_MACOS_TEAM_ID: 'TEAMID1234', CSC_LINK: settings.certificatePath, CSC_KEY_PASSWORD: settings.certificatePassword,
      APPLE_ID: settings.appleId, APPLE_APP_SPECIFIC_PASSWORD: settings.appleAppSpecificPassword, APPLE_TEAM_ID: 'TEAMID1234',
    })
    expect(() => renderTakoMacOSReleaseEnvironment({ ...settings, certificatePassword: 'a\nb' })).toThrow('line breaks')
    expect(() => renderTakoMacOSReleaseEnvironment({ ...settings, certificatePassword: '\'"`' })).toThrow('quote characters')
  })
})

describe('release assets', () => {
  it('names the files electron-builder writes for each release mode', () => {
    const version = TAKO_DESKTOP_VERSION
    const base = `${TAKO_DESKTOP_ARTIFACT_PREFIX}-${version}`
    const expectDirectory = (target: 'mac-arm64' | 'win-x64', mode: { unsigned: boolean; unsignedRelease?: boolean }, actual: string) => {
      const output = desktopArtifactOutput(desktopTargetBuildPaths(target), { skipNotarization: false, ...mode }).directory
      expect(join(APP_ROOT, actual)).toBe(output)
    }
    const signed = takoReleaseAssets('mac-arm64', version, 'signed')
    expect(signed.files).toEqual([`${base}-mac-arm64.dmg`, `${base}-mac-arm64.zip`, `${base}-mac-arm64.zip.blockmap`, 'latest-mac.yml'])
    expectDirectory('mac-arm64', { unsigned: false }, signed.directory)
    const unsigned = takoReleaseAssets('mac-arm64', version, 'unsigned')
    expect(unsigned).toMatchObject({ files: [`${base}-mac-arm64-unsigned.dmg`], updateMetadata: undefined })
    expectDirectory('mac-arm64', { unsigned: true }, unsigned.directory)
    const windows = takoReleaseAssets('win-x64', version, 'signed')
    expect(windows.files).toEqual([`${base}-win-x64.exe`, `${base}-win-x64.exe.blockmap`, 'latest.yml'])
    expectDirectory('win-x64', { unsigned: true, unsignedRelease: true }, windows.directory)
  })

  it('reads the files an electron-updater metadata file refers to', () => {
    const metadata = [
      'version: 0.1.0',
      'files:',
      '  - url: DSH-Tako-0.1.0-win-x64.exe',
      '    sha512: abc',
      '    size: 1',
      "path: 'DSH-Tako-0.1.0-win-x64.exe'",
      'sha512: abc',
      "releaseDate: '2026-10-25T00:00:00.000Z'",
    ].join('\n')
    expect(takoUpdateMetadataReferences(metadata)).toEqual({ version: '0.1.0', files: ['DSH-Tako-0.1.0-win-x64.exe'] })
  })

  it('collects a complete Windows release and rejects missing or inconsistent files', () => {
    const appRoot = temporary()
    const directory = join(appRoot, '.desktop-build/targets/win-x64/unsigned-artifacts')
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, 'DSH-Tako-0.1.0-win-x64.exe'), 'installer')
    const output = join(appRoot, 'release')
    const request = { target: 'win-x64', version: '0.1.0', mode: 'signed', output, appRoot } as const
    expect(() => collectTakoReleaseAssets(request)).toThrow('missing or empty release file')
    writeFileSync(join(directory, 'DSH-Tako-0.1.0-win-x64.exe.blockmap'), 'blockmap')
    writeFileSync(join(directory, 'latest.yml'), 'version: 0.1.0\nfiles:\n  - url: DSH-Tako-0.1.0-win-x64-unsigned.exe\n')
    expect(() => collectTakoReleaseAssets(request)).toThrow('must refer only to published files')
    writeFileSync(join(directory, 'latest.yml'), 'version: 0.0.9\nfiles:\n  - url: DSH-Tako-0.1.0-win-x64.exe\n')
    expect(() => collectTakoReleaseAssets(request)).toThrow('declares version 0.0.9')
    writeFileSync(join(directory, 'latest.yml'), 'version: 0.1.0\nfiles:\n  - url: DSH-Tako-0.1.0-win-x64.exe\npath: DSH-Tako-0.1.0-win-x64.exe\n')
    expect(collectTakoReleaseAssets(request)).toEqual(['DSH-Tako-0.1.0-win-x64.exe', 'DSH-Tako-0.1.0-win-x64.exe.blockmap', 'latest.yml'])
    expect(readdirSync(output).sort()).toEqual(['DSH-Tako-0.1.0-win-x64.exe', 'DSH-Tako-0.1.0-win-x64.exe.blockmap', 'latest.yml'])
  })

  it('writes sha256sum-compatible checksums for every release file', () => {
    const directory = temporary()
    writeFileSync(join(directory, 'b.txt'), 'b')
    writeFileSync(join(directory, 'a.txt'), 'a')
    expect(writeTakoReleaseChecksums(directory)).toBe([
      'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb  a.txt',
      '3e23e8160039594a33894f6564e1b1348bbd7a0088d42c4acb73eeaed59c009d  b.txt',
      '',
    ].join('\n'))
    expect(writeTakoReleaseChecksums(directory)).toBe(readFileSync(join(directory, 'SHA256SUMS.txt'), 'utf8'))
  })
})

describe('release notes', () => {
  it('fills every placeholder of the maintained template for both macOS modes', () => {
    const template = readFileSync(join(REPOSITORY_ROOT, '.github/tako-release-notes.md'), 'utf8')
    const signed = renderTakoReleaseNotes(template, '0.1.0', 'signed')
    expect(signed).toContain('`DSH-Tako-0.1.0-mac-arm64.dmg`')
    expect(signed).toContain('`DSH-Tako-0.1.0-win-x64.exe`')
    expect(signed).not.toContain('{{')
    expect(renderTakoReleaseNotes(template, '0.1.0', 'unsigned')).toContain('`DSH-Tako-0.1.0-mac-arm64-unsigned.dmg`')
    expect(() => renderTakoReleaseNotes('{{UNKNOWN}}', '0.1.0', 'signed')).toThrow('unknown placeholder')
  })
})
