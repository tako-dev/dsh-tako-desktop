import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, matchesGlob, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseEnv } from 'node:util'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { load } from 'js-yaml'
import {
  collectTakoReleaseAssets,
  compareTakoReleaseSizes,
  createTakoWindowsManualArchive,
  generateTakoReleaseDetails,
  readTakoDesktopVersionSource,
  renderTakoMacOSReleaseEnvironment,
  renderTakoReleaseNotes,
  renderTakoReleaseSizeReport,
  resolveTakoReleaseVersion,
  takoMacOSSigningIdentity,
  takoReleaseAssetRole,
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
    expect(resolveTakoReleaseVersion(`v${TAKO_DESKTOP_VERSION}`, TAKO_DESKTOP_VERSION)).toBe(TAKO_DESKTOP_VERSION)
    expect(() => resolveTakoReleaseVersion(TAKO_DESKTOP_VERSION, TAKO_DESKTOP_VERSION)).toThrow('must be v<version>')
    // A tag for some other release must never match the checked-out constant, whatever that constant is.
    expect(() => resolveTakoReleaseVersion('v9.9.9', TAKO_DESKTOP_VERSION))
      .toThrow(`does not match TAKO_DESKTOP_VERSION ${TAKO_DESKTOP_VERSION}`)
    expect(() => resolveTakoReleaseVersion('v0.2.0-beta.1', '0.2.0-beta.1')).toThrow('stable MAJOR.MINOR.PATCH')
    expect(() => resolveTakoReleaseVersion('v01.0.0', '01.0.0')).toThrow('stable MAJOR.MINOR.PATCH')
  })
})

describe('Windows release installation checks', () => {
  interface Step { name?: string; run?: string; uses?: string; if?: string; with?: Record<string, string | boolean> }
  interface Job { 'runs-on': string; permissions?: Record<string, string>; steps: Step[] }
  const release = load(readFileSync(join(REPOSITORY_ROOT, '.github/workflows/release.yml'), 'utf8')) as { jobs: Record<string, Job> }
  const ci = load(readFileSync(join(REPOSITORY_ROOT, '.github/workflows/ci.yml'), 'utf8')) as { jobs: Record<string, Job> }

  it('packages the release installer with the observation-only computer-use bundle', () => {
    const commands = release.jobs.windows!.steps.map(step => step.run ?? '').join('\n')
    expect(commands).toContain('pnpm run package:desktop:win:x64:unsigned-release --check --computer-use-win\n')
    expect(commands).toContain('pnpm run package:desktop:win:x64:unsigned-release --computer-use-win\n')
  })

  it('blocks collection and upload until the actual release installer passes', () => {
    const steps = release.jobs.windows!.steps
    const build = steps.findIndex(step => step.run?.includes('pnpm run package:desktop:win:x64:unsigned-release --computer-use-win\n'))
    const smoke = steps.findIndex(step => step.run?.includes('windows-release-install-smoke.ps1'))
    const collect = steps.findIndex(step => step.run?.includes('tako-release.mjs collect'))
    const upload = steps.findIndex(step => step.uses?.startsWith('actions/upload-artifact@'))
    expect(build).toBeGreaterThan(-1)
    expect(smoke).toBeGreaterThan(build)
    expect(collect).toBeGreaterThan(smoke)
    expect(upload).toBeGreaterThan(collect)
    expect(steps[smoke]!.if).toBeUndefined()
    const assets = takoReleaseAssets('win-x64', TAKO_DESKTOP_VERSION, 'signed')
    expect(steps[smoke]!.run?.replaceAll('$env:VERSION', TAKO_DESKTOP_VERSION))
      .toContain(`apps/desktop/${assets.directory}/${assets.files[0]}`)
    expect(steps[smoke]!.run).toContain('exit $LASTEXITCODE')
  })

  it('keeps installation evidence out of public release assets', () => {
    const download = release.jobs.publish!.steps.find(step => step.uses?.startsWith('actions/download-artifact@'))!
    const pattern = download.with!.pattern as string
    const evidence = release.jobs.windows!.steps.find(step => step.name === 'Retain installation evidence')!
    expect(evidence.if).toBe('always()')
    const published = Object.values(release.jobs).flatMap(job => job.steps
      .filter(step => step.uses?.startsWith('actions/upload-artifact@') && matchesGlob(step.with!.name as string, pattern))
      .map(step => step.with!.name))
    expect(published.sort()).toEqual(['release-mac-arm64', 'release-win-x64'])
  })

  it('runs the real Windows installer and failure-cleanup control without publication rights in PR CI', () => {
    const job = ci.jobs['windows-install-smoke']
    expect(job).toBeDefined()
    expect(job!['runs-on']).toBe('windows-latest')
    expect(job!.permissions).toEqual({ contents: 'read' })
    const commands = job!.steps.map(step => step.run ?? '').join('\n')
    expect(commands).toContain('pnpm run package:desktop:win:x64:unsigned-release --computer-use-win')
    expect(commands).toContain('-Version 0.0.0')
    expect(commands).toContain('Expected the mismatched version check to fail')
    expect(commands).toContain('$control.cleanup -ne \'passed\'')
    expect(commands).toContain('windows-release-install-smoke.ps1')
    expect(commands).not.toMatch(/gh release|git (?:tag|push)/u)
  })
})

describe('installed application smoke lifecycle', () => {
  interface ApplicationReport {
    status: string
    stage: string
    failureStage?: string
    checks: string[]
    uncaughtException?: string
    unhandledRejection?: string
    exitError?: string
    launchedProcess?: { pid: number; exitCode: number | null; signal: string | null; exited: boolean }
    error?: string
    shutdownError?: string
    diagnosticsError?: string
    outputError?: string
    reportError?: string
    crashes?: string[]
    shutdownCrashes?: string[]
  }

  function fixture() {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-release-smoke-')))
    const children: ChildProcessWithoutNullStreams[] = []
    const exits: Promise<unknown>[] = []
    onTestFinished(async () => {
      for (const child of children) {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      }
      await Promise.allSettled(exits)
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    })
    const home = join(root, 'Harness Home 中文')
    const userData = join(root, 'Electron User Data')
    const output = join(root, 'Evidence')
    mkdirSync(output)
    const executable = join(root, 'Installed App', 'DSH Tako.exe')
    function start(scenario: string, seconds = '10') {
      const child = spawn(process.execPath, [
        '--import', pathToFileURL(join(APP_ROOT, 'tests/fixtures/release-app-driver.mjs')).href,
        join(APP_ROOT, 'tests/windows-release-app-smoke.mjs'),
        executable, TAKO_DESKTOP_VERSION, home, userData, output, seconds, scenario,
      ], { cwd: REPOSITORY_ROOT, stdio: 'pipe', env: { ...process.env, NODE_OPTIONS: '', ELECTRON_RUN_AS_NODE: '1',
        RELEASE_SMOKE_SENTINEL_TOKEN: 'must-not-reach-the-application', TAKO_PRIVATE_SETTING: 'must-not-reach-the-application' } })
      children.push(child)
      let stdout = ''
      let stderr = ''
      child.stdout.setEncoding('utf8').on('data', (text: string) => { stdout += text })
      child.stderr.setEncoding('utf8').on('data', (text: string) => { stderr += text })
      const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveExit, reject) => {
        child.once('error', reject)
        child.once('close', (code, signal) => { resolveExit({ code, signal }) })
      })
      exits.push(closed)
      child.stdin.end()
      return { closed, stdout: () => stdout, stderr: () => stderr }
    }
    async function run(scenario: string, seconds?: string) {
      const child = start(scenario, seconds)
      const exit = await child.closed
      expect(exit.signal, child.stderr()).toBeNull()
      const report = JSON.parse(readFileSync(join(output, 'application.json'), 'utf8')) as ApplicationReport
      return { ...exit, report, stdout: child.stdout(), stderr: child.stderr() }
    }
    return { root, home, userData, output, start, run }
  }

  it('waits for interactive welcome readiness and normal process exit with private state and no credentials', async () => {
    const f = fixture()
    const result = await f.run('normal')
    expect(result.code, result.stderr).toBe(0)
    expect(result.report.status).toBe('passed')
    expect(result.report.checks).toEqual(['installed-executable-and-private-state', 'host-ready-and-welcome-interactive-without-login', 'normal-application-shutdown'])
    expect(result.report.launchedProcess).toMatchObject({ exitCode: 0, signal: null, exited: true })
    expect(readFileSync(join(f.output, 'application.stdout.log'), 'utf8')).toBe('controlled application stdout\n')
    expect(readFileSync(join(f.output, 'application.stderr.log'), 'utf8')).toBe('controlled application stderr\n')
    expect(existsSync(join(f.output, 'welcome.png'))).toBe(true)
    expect(existsSync(join(f.output, 'api-key.png'))).toBe(true)
  })

  it.each(['existing-empty-url', 'empty-window-url', 'blank-window-url', 'invalid-window-url'])(
    'waits for welcome navigation instead of treating %s as readiness or a fatal error', async (scenario) => {
      const result = await fixture().run(scenario)
      expect(result.code, result.stderr).toBe(0)
      expect(result.report.status).toBe('passed')
      expect(result.report.checks).toContain('host-ready-and-welcome-interactive-without-login')
      expect(result.report.checks).toContain('normal-application-shutdown')
      expect(result.report.launchedProcess).toMatchObject({ exitCode: 0, signal: null, exited: true })
    },
  )

  it.each(['window-url-error', 'dom-url-error'])('contains %s in the welcome wait and completes normal shutdown', async (scenario) => {
    const result = await fixture().run(scenario)
    expect(result.code, result.stderr).toBe(1)
    expect(result.report.status).toBe('failed')
    expect(result.report.failureStage).toBe('welcome-ready')
    expect(result.report.error).toContain('Controlled welcome URL read failure')
    expect(result.report.uncaughtException).toBeUndefined()
    expect(result.report.checks).not.toContain('host-ready-and-welcome-interactive-without-login')
    expect(result.report.checks).toContain('normal-application-shutdown')
    expect(result.report.launchedProcess).toMatchObject({ exitCode: 0, signal: null, exited: true })
  })

  it.each([
    ['early-exit', 'before normal shutdown was requested', 7, null],
    ['already-exited', 'before normal shutdown was requested', 7, null],
    ['nonzero-exit', 'exited unsuccessfully', 7, null],
    ['signal-exit', 'interrupted by a signal', null, 'SIGSEGV'],
  ] as const)('rejects %s even when the close operation succeeds', async (scenario, message, exitCode, signal) => {
    const result = await fixture().run(scenario)
    expect(result.code, result.stderr).toBe(1)
    expect(result.report.status).toBe('failed')
    expect(result.report.shutdownError).toContain(message)
    expect(result.report.launchedProcess).toMatchObject({ exitCode, signal, exited: true })
    expect(result.report.checks).not.toContain('normal-application-shutdown')
  })

  it.each([
    ['launch-failure', 'Controlled launch failure'],
    ['wrong-version', '99.0.0'],
    ['missing-welcome', 'did not open its welcome renderer'],
    ['startup-diagnostic', 'AssertionError'],
  ])('rejects %s without substituting process survival for readiness', async (scenario, message) => {
    const result = await fixture().run(scenario, scenario === 'missing-welcome' ? '0.05' : undefined)
    expect(result.code, result.stderr).toBe(1)
    expect(result.report.status).toBe('failed')
    expect(result.report.error).toContain(message)
  })

  it('retains failures before launch and prints the report to stderr', async () => {
    const f = fixture()
    const imported = await f.run('import-failure')
    expect(imported.code, imported.stderr).toBe(1)
    expect(imported.report.failureStage).toBe('load-playwright')
    expect(imported.report.error).toContain('Controlled Playwright import failure')
    expect(imported.stderr).toContain(imported.report.error)
    expect(imported.stderr).toContain('"status": "failed"')

    rmSync(f.home, { recursive: true, force: true })
    writeFileSync(f.home, 'not a directory')
    const prepared = await f.run('normal')
    expect(prepared.code, prepared.stderr).toBe(1)
    expect(prepared.report.failureStage).toBe('prepare-private-state')
    expect(prepared.stderr).toContain(prepared.report.error)
  })

  it.each([
    ['uncaught-exception', 'uncaughtException'],
    ['unhandled-rejection', 'unhandledRejection'],
    ['direct-exit', 'exitError'],
  ] as const)('retains a report and stderr for %s outside the awaited launch', async (scenario, field) => {
    const result = await fixture().run(scenario)
    expect(result.code, result.stderr).toBe(1)
    expect(result.report.status).toBe('failed')
    expect(result.report.failureStage).toBe('electron-launch')
    expect(result.report[field]).toContain(scenario === 'direct-exit' ? 'exited with code 1' : `Controlled ${scenario}`)
    expect(result.stderr).toContain(result.report[field])
    expect(result.stderr).toContain('"status": "failed"')
  })

  it('prints report-write errors to stderr when the evidence file cannot be written', async () => {
    const f = fixture()
    mkdirSync(join(f.output, 'application.json'))
    const child = f.start('launch-failure')
    const exit = await child.closed
    expect(exit.signal, child.stderr()).toBeNull()
    expect(exit.code, child.stderr()).toBe(1)
    const report = JSON.parse(child.stdout()) as ApplicationReport
    expect(report.error).toContain('Controlled launch failure')
    expect(report.reportError).toBeTruthy()
    expect(child.stderr()).toContain(report.reportError)
  })

  it('fails on a crash report written before shutdown and retains its contents', async () => {
    const f = fixture()
    const result = await f.run('crash-report')
    expect(result.code, result.stderr).toBe(1)
    expect(result.report.status).toBe('failed')
    expect(result.report.crashes).toEqual(['crash-test-main.log'])
    await rm(f.userData, { recursive: true, maxRetries: 10, retryDelay: 100 })
    expect(readFileSync(join(f.output, 'crashes/crash-test-main.log'), 'utf8')).toBe('retained crash contents\n')
  })

  it('retains a crash report written during the requested shutdown as evidence without failing the check', async () => {
    const f = fixture()
    const result = await f.run('shutdown-crash-report')
    expect(result.code, result.stderr).toBe(0)
    expect(result.report.status).toBe('passed')
    expect(result.report.crashes).toEqual([])
    expect(result.report.shutdownCrashes).toEqual(['crash-test-shutdown-web-boot.log'])
    await rm(f.userData, { recursive: true, maxRetries: 10, retryDelay: 100 })
    expect(readFileSync(join(f.output, 'crashes/crash-test-shutdown-web-boot.log'), 'utf8')).toBe('shutdown crash contents\n')
  })

  it('reports a crash-copy failure without losing application output or the structured report', async () => {
    const f = fixture()
    const result = await f.run('crash-copy-failure')
    expect(result.code, result.stderr).toBe(1)
    expect(result.report.status).toBe('failed')
    expect(result.report.diagnosticsError).toBeTruthy()
    expect(readFileSync(join(f.output, 'application.stderr.log'), 'utf8')).toBe('controlled application stderr\n')
  })

  it('reports an output-write failure independently of the application result', async () => {
    const f = fixture()
    mkdirSync(join(f.output, 'application.stdout.log'))
    const result = await f.run('normal')
    expect(result.code, result.stderr).toBe(1)
    expect(result.report.status).toBe('failed')
    expect(result.report.outputError).toBeTruthy()
    expect(result.report.checks).toContain('normal-application-shutdown')
  })

  it('isolates concurrent helper processes and their evidence directories', async () => {
    const first = fixture()
    const second = fixture()
    expect(first.root).not.toBe(second.root)
    const results = await Promise.all([first.run('normal'), second.run('normal')])
    expect(results.map(result => result.code)).toEqual([0, 0])
    for (const f of [first, second]) expect(existsSync(join(f.output, 'welcome.png'))).toBe(true)
  })
})

it.skipIf(process.platform !== 'win32')('recognizes versioned uninstall entries, checks shortcut targets, and removes only private protocol registrations', async () => {
  const child = spawn('pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-File',
    join(APP_ROOT, 'tests/fixtures/release-install-driver.ps1'), '-Smoke', join(APP_ROOT, 'tests/windows-release-install-smoke.ps1')],
  { cwd: REPOSITORY_ROOT, stdio: 'pipe' })
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveExit, reject) => {
    child.once('error', reject)
    child.once('close', (code, signal) => { resolveExit({ code, signal }) })
  })
  onTestFinished(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    await Promise.allSettled([closed])
  })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8').on('data', (text: string) => { stdout += text })
  child.stderr.setEncoding('utf8').on('data', (text: string) => { stderr += text })
  child.stdin.end()
  const exit = await closed
  expect(exit.signal, stderr).toBeNull()
  expect(exit.code, stderr).toBe(0)
  expect(stdout).toContain('uninstall-entries: versioned and older product names detected; foreign prefix excluded')
  expect(stdout).toContain('node-selection: first executable selected from multiple PATH entries')
  expect(stdout).toContain('process-capture: stdout, stderr, nonzero exit, pipe pressure, and deadline teardown retained')
  expect(stdout).toContain('shortcut-checks: target verified; same-name foreign target rejected')
  expect(stdout).toContain('protocol-cleanup: absent, owned, and foreign registrations verified')
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
    expect(signed.files).toEqual([`${base}-mac-arm64.dmg`, `${base}-mac-arm64.zip`, `${base}-mac-arm64.zip.blockmap`, 'stable-mac.yml', 'latest-mac.yml'])
    expect(signed).toMatchObject({ updateMetadata: 'stable-mac.yml', legacyMetadata: 'latest-mac.yml' })
    expectDirectory('mac-arm64', { unsigned: false }, signed.directory)
    const unsigned = takoReleaseAssets('mac-arm64', version, 'unsigned')
    expect(unsigned).toMatchObject({ files: [`${base}-mac-arm64-unsigned.dmg`], updateMetadata: undefined })
    expectDirectory('mac-arm64', { unsigned: true }, unsigned.directory)
    const windows = takoReleaseAssets('win-x64', version, 'signed')
    expect(windows.files).toEqual([`${base}-win-x64.exe`, `${base}-win-x64.exe.blockmap`, 'stable.yml', 'latest.yml'])
    expect(windows).toMatchObject({ updateMetadata: 'stable.yml', legacyMetadata: 'latest.yml' })
    expect(windows.manualArchive).toBe(`${base}-win-x64.zip`)
    expectDirectory('win-x64', { unsigned: true, unsignedRelease: true }, windows.directory)
  })

  it('reads the files an electron-updater metadata file refers to', () => {
    const artifact = `${TAKO_DESKTOP_ARTIFACT_PREFIX}-${TAKO_DESKTOP_VERSION}-win-x64.exe`
    const metadata = [
      `version: ${TAKO_DESKTOP_VERSION}`,
      'files:',
      `  - url: ${artifact}`,
      '    sha512: abc',
      '    size: 1',
      `path: '${artifact}'`,
      'sha512: abc',
      "releaseDate: '2026-10-25T00:00:00.000Z'",
    ].join('\n')
    expect(takoUpdateMetadataReferences(metadata)).toEqual({ version: TAKO_DESKTOP_VERSION, files: [artifact] })
  })

  it('collects a complete Windows release and rejects missing or inconsistent files', () => {
    const appRoot = temporary()
    const directory = join(appRoot, '.desktop-build/targets/win-x64/unsigned-artifacts')
    mkdirSync(directory, { recursive: true })
    const artifact = `${TAKO_DESKTOP_ARTIFACT_PREFIX}-${TAKO_DESKTOP_VERSION}-win-x64.exe`
    const archive = `${TAKO_DESKTOP_ARTIFACT_PREFIX}-${TAKO_DESKTOP_VERSION}-win-x64.zip`
    const expected = [artifact, `${artifact}.blockmap`, 'stable.yml', 'latest.yml', archive]
    writeFileSync(join(directory, artifact), 'installer')
    const output = join(appRoot, 'release')
    const request = { target: 'win-x64', version: TAKO_DESKTOP_VERSION, mode: 'signed', output, appRoot } as const
    expect(() => collectTakoReleaseAssets(request)).toThrow('missing or empty release file')
    writeFileSync(join(directory, `${artifact}.blockmap`), 'blockmap')
    writeFileSync(join(directory, 'stable.yml'), `version: ${TAKO_DESKTOP_VERSION}\nfiles:\n  - url: ${TAKO_DESKTOP_ARTIFACT_PREFIX}-${TAKO_DESKTOP_VERSION}-win-x64-unsigned.exe\n`)
    expect(() => collectTakoReleaseAssets(request)).toThrow('must refer only to published files')
    // A metadata file for another release is stale and must be rejected.
    writeFileSync(join(directory, 'stable.yml'), `version: 0.0.9\nfiles:\n  - url: ${artifact}\n`)
    expect(() => collectTakoReleaseAssets(request)).toThrow('declares version 0.0.9')
    writeFileSync(join(directory, 'stable.yml'), `version: ${TAKO_DESKTOP_VERSION}\nfiles:\n  - url: ${artifact}\npath: ${artifact}\n`)
    const createArchive = vi.fn((directory: string) => { writeFileSync(join(directory, archive), 'zip'); return archive })
    expect(collectTakoReleaseAssets(request, createArchive)).toEqual(expected)
    expect(createArchive).toHaveBeenCalledExactlyOnceWith(output, TAKO_DESKTOP_VERSION)
    expect(readdirSync(output).sort()).toEqual([...expected].sort())
  })

  it('creates a manual Windows ZIP containing only the installer', () => {
    const directory = temporary()
    const installer = `${TAKO_DESKTOP_ARTIFACT_PREFIX}-${TAKO_DESKTOP_VERSION}-win-x64.exe`
    const archive = `${TAKO_DESKTOP_ARTIFACT_PREFIX}-${TAKO_DESKTOP_VERSION}-win-x64.zip`
    const run = vi.fn((_command: string, args: string[]) => {
      if (args.includes('-cf')) { writeFileSync(join(directory, archive), 'archive'); return Buffer.alloc(0) }
      return `${installer}\n`
    })
    expect(createTakoWindowsManualArchive(directory, TAKO_DESKTOP_VERSION, run)).toBe(archive)
    expect(run.mock.calls.map(call => call[0])).toEqual(['tar', 'tar'])
    expect(existsSync(join(directory, archive))).toBe(true)
  })

  it('rejects a manual Windows archive containing anything except the installer', () => {
    const directory = temporary()
    const archive = join(directory, `${TAKO_DESKTOP_ARTIFACT_PREFIX}-${TAKO_DESKTOP_VERSION}-win-x64.zip`)
    const run = vi.fn((_command: string, args: string[]) => {
      if (args.includes('-cf')) { writeFileSync(archive, 'archive'); return Buffer.alloc(0) }
      return 'unexpected.exe\n'
    })
    expect(() => createTakoWindowsManualArchive(directory, TAKO_DESKTOP_VERSION, run))
      .toThrow('archive contains unexpected files')
    expect(existsSync(archive)).toBe(false)
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
    const base = `${TAKO_DESKTOP_ARTIFACT_PREFIX}-${TAKO_DESKTOP_VERSION}`
    const signed = renderTakoReleaseNotes(template, TAKO_DESKTOP_VERSION, 'signed')
    expect(signed).toContain(`\`${base}-mac-arm64.dmg\``)
    expect(signed).toContain(`\`${base}-win-x64.zip\``)
    expect(signed).toContain(`\`${base}-win-x64.exe\``)
    expect(signed).not.toContain('{{')
    expect(renderTakoReleaseNotes(template, TAKO_DESKTOP_VERSION, 'unsigned')).toContain(`\`${base}-mac-arm64-unsigned.dmg\``)
    expect(() => renderTakoReleaseNotes('{{UNKNOWN}}', TAKO_DESKTOP_VERSION, 'signed')).toThrow('unknown placeholder')
  })
})

describe('version-specific release details', () => {
  const source = { repository: 'tako-dev/dsh-tako-desktop', version: '0.1.46', commit: 'a'.repeat(40), runtimeVersion: '0.2.1-rc.5' }

  it('uses the exact build commit and includes change links and runtime source', async () => {
    const calls: { url: string; body: string }[] = []
    const fetchImpl: typeof fetch = async (input, init) => {
      if (typeof input !== 'string' || typeof init?.body !== 'string') throw new Error('expected JSON request')
      calls.push({ url: input, body: init.body })
      return Response.json({ body: "## What's Changed\n* Copy report path in https://github.com/tako-dev/dsh-tako-desktop/pull/31" })
    }
    const details = await generateTakoReleaseDetails(source, fetchImpl)
    expect(calls).toEqual([{ url: 'https://api.github.com/repos/tako-dev/dsh-tako-desktop/releases/generate-notes',
      body: JSON.stringify({ tag_name: 'v0.1.46', target_commitish: source.commit }) }])
    expect(details).toBe(readFileSync(join(APP_ROOT, 'tests/expected/tako-release-details.txt'), 'utf8'))
    expect(details).toContain('/pull/31')
    expect(details).toContain(`/commit/${source.commit}`)
    expect(details).toContain('0.2.1-rc.5')
    expect(details).toContain(`/blob/${source.commit}/package.json`)
    const template = readFileSync(join(REPOSITORY_ROOT, '.github/tako-release-notes.md'), 'utf8')
    expect(renderTakoReleaseNotes(template, source.version, 'signed', details)).toContain(details)
  })

  it('stops rather than publishing missing or invalid change details', async () => {
    const failed: typeof fetch = async () => Response.json({}, { status: 403 })
    await expect(generateTakoReleaseDetails(source, failed)).rejects.toThrow('403')
    const empty: typeof fetch = async () => Response.json({ body: '' })
    await expect(generateTakoReleaseDetails(source, empty)).rejects.toThrow('no version-specific change summary')
    await expect(generateTakoReleaseDetails({ ...source, commit: 'HEAD' }, empty)).rejects.toThrow('invalid release source identity')
  })
})

describe('release artifact sizes', () => {
  it('matches artifacts across releases by their version-independent name', () => {
    expect(takoReleaseAssetRole('DSH-Tako-0.1.36-win-x64.exe')).toBe('DSH-Tako-<version>-win-x64.exe')
    const rows = compareTakoReleaseSizes(
      [
        { name: 'DSH-Tako-0.1.35-win-x64.exe', size: 100 },
        { name: 'DSH-Tako-0.1.35-win-x64.exe.blockmap', size: 10 },
      ],
      [
        { name: 'DSH-Tako-0.1.36-win-x64.exe', size: 120 },
        { name: 'DSH-Tako-0.1.36-win-x64.exe.blockmap', size: 10 },
        { name: 'latest-mac.yml', size: 1 },
      ],
    )
    expect(rows).toEqual([
      { name: 'DSH-Tako-0.1.36-win-x64.exe', previous: 100, current: 120, growth: 0.2 },
      { name: 'DSH-Tako-0.1.36-win-x64.exe.blockmap', previous: 10, current: 10, growth: 0 },
      { name: 'latest-mac.yml', previous: undefined, current: 1, growth: undefined },
    ])
    expect(rows[0]!.growth).toBeCloseTo(0.2, 10)
  })

  it('warns only when an artifact grows past the threshold', () => {
    const rows = compareTakoReleaseSizes(
      [{ name: 'DSH-Tako-0.1.35-win-x64.exe', size: 100 }],
      [{ name: 'DSH-Tako-0.1.36-win-x64.exe', size: 120 }],
    )
    expect(renderTakoReleaseSizeReport(rows, 5).regressions).toEqual(['DSH-Tako-0.1.36-win-x64.exe +20.0%'])
    expect(renderTakoReleaseSizeReport(rows, 5).text).toContain('::warning title=Release artifact grew past 5%::')
    expect(renderTakoReleaseSizeReport(rows, 25).regressions).toEqual([])
    expect(renderTakoReleaseSizeReport(rows, 25).text).not.toContain('::warning')
  })
})
