/** The integrity-locked optional `@xmanrui/dsh-im` packaging candidate and its release gate. */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import {
  IM_CANDIDATE_DIR,
  IM_CANDIDATE_LOCKFILE,
  IM_CANDIDATE_MANIFEST_FILE,
  IM_CANDIDATE_MAX_BYTES,
  IM_CANDIDATE_PACKAGE,
  IM_CANDIDATE_WORKSPACE_FILE,
  ImCandidateError,
  assertImCandidateReleaseEligible,
  readCandidateInputs,
  readImCandidateDescriptorFile,
  stageDesktopImCandidate,
  verifyDesktopImCandidate,
  type ImCandidateDescriptor,
} from '../scripts/im-candidate.ts'
import { loadImCandidatePackage, prepareDesktopPackageSet } from '../scripts/prepare-package-set.ts'
import { DESKTOP_PACKAGES_DIR, DESKTOP_PACKAGE_SET_FILE, parseDesktopCorePackageSet } from '../src/core-package-set.ts'
import {
  assertDesktopImCandidateRequest,
  parseDesktopPackageInvocation,
} from '../scripts/package-target.ts'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'im-candidate-'))
  roots.push(root)
  return root
}

const CANDIDATE_VERSION = '5.10.0'
const ARCHIVE_FILE = `dsh-im-${CANDIDATE_VERSION}.tgz`

/** A minimal ustar tarball packing `package/package.json` plus extra members. */
function archiveBytes(manifest: Record<string, unknown>, extra: Record<string, string> = {}): Buffer {
  const entries: [string, Buffer][] = [
    ['package/package.json', Buffer.from(`${JSON.stringify(manifest, undefined, 2)}\n`)],
    ...Object.entries(extra).map(([name, body]): [string, Buffer] => [`package/${name}`, Buffer.from(body)]),
  ]
  const blocks: Buffer[] = []
  for (const [name, data] of entries) {
    const header = Buffer.alloc(512)
    header.write(name, 0, 100)
    header.write('000644', 100, 7)
    header.write('000000', 108, 7)
    header.write('000000', 116, 7)
    header.write(data.byteLength.toString(8).padStart(11, ' '), 124, 12)
    header.write('00000000000', 136, 11)
    header.write(' ', 147, 1)
    header.write('        ', 148, 8)
    header.write('0', 156, 1)
    header.write('ustar', 257, 5)
    header.write('00', 263, 2)
    let checksum = 0
    for (const byte of header) checksum += byte
    header.write(checksum.toString(8).padStart(6, '0'), 148, 6)
    header.write(' ', 155, 1)
    blocks.push(header, data, Buffer.alloc(Math.ceil(data.byteLength / 512) * 512 - data.byteLength))
  }
  blocks.push(Buffer.alloc(1024))
  return gzipSync(Buffer.concat(blocks))
}

interface LockPackageSpec {
  readonly integrity?: string
}

function lockfile(spec: {
  specifier?: string
  version?: string
  dependencies?: Record<string, string>
  packages?: Record<string, LockPackageSpec>
  snapshots?: Record<string, Record<string, Record<string, string>>>
}): string {
  const version = spec.version ?? CANDIDATE_VERSION
  const rootKey = `${IM_CANDIDATE_PACKAGE}@${version}`
  const dependencies = spec.dependencies ?? { 'dep-a': '1.0.0' }
  const packages = spec.packages ?? {
    [rootKey]: { integrity: 'sha512-root' },
    'dep-a@1.0.0': { integrity: 'sha512-a' },
  }
  const snapshots = spec.snapshots ?? {
    [rootKey]: { dependencies },
    'dep-a@1.0.0': {},
  }
  const lines = [
    'lockfileVersion: \'9.0\'',
    '',
    'importers:',
    '',
    '  .:',
    '    dependencies:',
    `      '${IM_CANDIDATE_PACKAGE}':`,
    `        specifier: ${spec.specifier ?? CANDIDATE_VERSION}`,
    `        version: ${version}`,
    '',
    'packages:',
    '',
    ...Object.entries(packages).flatMap(([key, entry]) => [
      `  '${key}':`,
      entry.integrity === undefined ? '    resolution: {}' : `    resolution: {integrity: ${entry.integrity}}`,
      '',
    ]),
    'snapshots:',
    '',
    ...Object.entries(snapshots).flatMap(([key, entry]) => [
      ...(Object.keys(entry).length === 0
        ? [`  '${key}': {}`]
        : [
          `  '${key}':`,
          ...Object.entries(entry).flatMap(([section, members]) => [
            `    ${section}:`,
            ...Object.entries(members).map(([name, value]) => `      '${name}': ${value}`),
          ]),
        ]),
      '',
    ]),
  ]
  return `${lines.join('\n')}\n`
}

interface Fixture {
  readonly dir: string
  readonly descriptor: ImCandidateDescriptor
  readonly archive: Buffer
  readonly lock: string
}

function writeFixture(overrides: {
  manifest?: Record<string, unknown>
  workspace?: string
  lock?: string
  archive?: Buffer
  releaseEligible?: boolean
  blockers?: string[]
} = {}): Fixture {
  const dir = join(tempRoot(), 'candidate')
  mkdirSync(dir, { recursive: true })
  const manifest = overrides.manifest ?? {
    name: 'dsh-im-candidate',
    private: true,
    packageManager: 'pnpm@11.28.5',
    dependencies: { [IM_CANDIDATE_PACKAGE]: CANDIDATE_VERSION },
  }
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, undefined, 2)}\n`)
  const workspace = overrides.workspace ?? 'packages:\n  - .\nnodeLinker: hoisted\nautoInstallPeers: false\nallowBuilds: {}\n'
  const lock = overrides.lock ?? lockfile({})
  const archive = overrides.archive ?? archiveBytes(
    { name: IM_CANDIDATE_PACKAGE, version: CANDIDATE_VERSION },
    { 'cordis.patch.yml': 'insert: []\n', 'lib/index.js': '// im\n' },
  )
  const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex')
  writeFileSync(join(dir, IM_CANDIDATE_MANIFEST_FILE), manifestBytes)
  writeFileSync(join(dir, IM_CANDIDATE_WORKSPACE_FILE), workspace)
  writeFileSync(join(dir, IM_CANDIDATE_LOCKFILE), lock)
  writeFileSync(join(dir, ARCHIVE_FILE), archive)
  const descriptor: ImCandidateDescriptor = {
    schemaVersion: 1,
    package: IM_CANDIDATE_PACKAGE,
    version: CANDIDATE_VERSION,
    integrity: `sha512-${createHash('sha512').update(archive).digest('base64')}`,
    archiveUrl: `https://registry.npmjs.org/${IM_CANDIDATE_PACKAGE}/-/${ARCHIVE_FILE}`,
    archiveFile: ARCHIVE_FILE,
    lockSha256: sha256(lock),
    manifestSha256: sha256(manifestBytes),
    workspaceSha256: sha256(workspace),
    releaseEligible: overrides.releaseEligible ?? false,
    blockers: overrides.blockers ?? ['dsh.compatibility declares only up to 0.2.1-rc.2'],
  }
  writeFileSync(join(dir, 'candidate.json'), `${JSON.stringify(descriptor, undefined, 2)}\n`)
  return { dir, descriptor, archive, lock }
}

describe('im candidate verification', () => {
  it('verifies a captured candidate once through every review pin', () => {
    const { dir } = writeFixture()
    const candidate = verifyDesktopImCandidate(dir)
    expect(candidate.descriptor.package).toBe(IM_CANDIDATE_PACKAGE)
    expect(candidate.lockedPackages).toBe(2)
    expect(candidate.archiveFiles).toBe(3)
    expect(candidate.descriptor.releaseEligible).toBe(false)
  })

  it('reads the committed candidate descriptor with its review pins', () => {
    const descriptor = readImCandidateDescriptorFile(join(import.meta.dirname, '..', IM_CANDIDATE_DIR))
    expect(descriptor).toMatchObject({
      package: IM_CANDIDATE_PACKAGE,
      version: CANDIDATE_VERSION,
      archiveFile: ARCHIVE_FILE,
      releaseEligible: false,
    })
    expect(descriptor.integrity).toMatch(/^sha512-/u)
    expect(descriptor.archiveUrl).toBe(`https://registry.npmjs.org/${IM_CANDIDATE_PACKAGE}/-/${ARCHIVE_FILE}`)
    for (const hex of [descriptor.lockSha256, descriptor.manifestSha256, descriptor.workspaceSha256]) {
      expect(hex).toMatch(/^[0-9a-f]{64}$/u)
    }
    expect(descriptor.blockers.length).toBeGreaterThan(0)
  })

  it('accepts peer-suffixed resolutions and nested optional dependencies', () => {
    const lock = lockfile({
      version: '5.10.0(debug@4.4.3)',
      dependencies: { 'dep-a': '1.0.0' },
      packages: {
        [`${IM_CANDIDATE_PACKAGE}@${CANDIDATE_VERSION}`]: { integrity: 'sha512-root' },
        'dep-a@1.0.0': { integrity: 'sha512-a' },
        'dep-b@2.0.0': { integrity: 'sha512-b' },
        'debug@4.4.3': { integrity: 'sha512-d' },
      },
      snapshots: {
        [`${IM_CANDIDATE_PACKAGE}@5.10.0(debug@4.4.3)`]: {
          dependencies: { 'dep-a': '1.0.0', 'dep-b': 'dep-b@2.0.0' },
          optionalDependencies: { 'debug': '4.4.3' },
        },
        'dep-a@1.0.0': {},
        'dep-b@2.0.0': {},
        'debug@4.4.3': {},
      },
    })
    const { dir } = writeFixture({ lock })
    expect(verifyDesktopImCandidate(dir).lockedPackages).toBe(4)
  })

  it.each([
    'empty snapshot',
    'changed dependency pointer',
    'changed transitive integrity',
    'trailing whitespace',
  ] as const)('reports %s as reviewed-byte drift', (label) => {
    const { dir, descriptor } = writeFixture()
    const lockPath = join(dir, IM_CANDIDATE_LOCKFILE)
    const original = readFileSync(lockPath)
    const changed = label === 'empty snapshot'
      ? Buffer.alloc(0)
      : label === 'trailing whitespace'
        ? Buffer.concat([original, Buffer.from(' \n')])
        : label === 'changed dependency pointer'
          ? Buffer.from(original.toString('utf8').replace('dep-a@1.0.0', 'dep-a@1.0.1'))
          : Buffer.from(original.toString('utf8').replace('sha512-a', 'sha512-b'))
    writeFileSync(lockPath, changed)
    expect(() => verifyDesktopImCandidate(dir)).toThrow(/lockfile bytes changed since review/u)
    try {
      verifyDesktopImCandidate(dir)
    } catch (error) {
      expect(error).toBeInstanceOf(ImCandidateError)
      expect((error as ImCandidateError).code).toBe('candidate-lock')
    }
    expect(descriptor.lockSha256).not.toBe(createHash('sha256').update(changed).digest('hex'))
  })

  it('rejects invalid YAML lock bytes before any staging starts', () => {
    const invalid = 'lockfileVersion: [unclosed\n'
    const { dir } = writeFixture({ lock: invalid })
    const stage = join(tempRoot(), 'stage')
    expect(() => verifyDesktopImCandidate(dir)).toThrow(/lockfile is not valid YAML/u)
    expect(existsSync(stage)).toBe(false)
    expect(readFileSync(join(dir, IM_CANDIDATE_LOCKFILE), 'utf8')).toBe(invalid)
  })

  it.each([
    [
      'an importer resolution missing from the snapshots',
      {
        packages: {
          [`${IM_CANDIDATE_PACKAGE}@${CANDIDATE_VERSION}`]: { integrity: 'sha512-root' },
          'dep-a@1.0.0': { integrity: 'sha512-a' },
        },
        snapshots: { 'dep-a@1.0.0': {} },
      },
      /outside the reviewed snapshot/u,
    ],
    [
      'a package entry without a registry integrity',
      {
        packages: {
          [`${IM_CANDIDATE_PACKAGE}@${CANDIDATE_VERSION}`]: { integrity: 'sha512-root' },
          'dep-a@1.0.0': {},
        },
      },
      /without a reviewed registry integrity/u,
    ],
  ])('rejects %s', (_label, lockOverrides, message) => {
    const { dir } = writeFixture({ lock: lockfile(lockOverrides) })
    expect(() => verifyDesktopImCandidate(dir)).toThrow(message)
  })

  it('rejects an importer specifier that is not the exact pin', () => {
    const { dir } = writeFixture({ lock: lockfile({ specifier: `^${CANDIDATE_VERSION}` }) })
    expect(() => verifyDesktopImCandidate(dir)).toThrow(/not exact/u)
  })

  it('rejects an importer resolution whose version drifts from the pin', () => {
    const { dir } = writeFixture({
      lock: lockfile({
        version: '5.10.1',
        packages: { '@xmanrui/dsh-im@5.10.1': { integrity: 'sha512-root' }, 'dep-a@1.0.0': { integrity: 'sha512-a' } },
        snapshots: { '@xmanrui/dsh-im@5.10.1': { dependencies: { 'dep-a': '1.0.0' } }, 'dep-a@1.0.0': {} },
      }),
    })
    // The importer's resolved version must equal the pinned specifier.
    expect(() => verifyDesktopImCandidate(dir)).toThrow(/not exact/u)
  })

  it('rejects a resolution that escapes into a non-version target', () => {
    const { dir } = writeFixture({
      lock: lockfile({
        snapshots: {
          [`${IM_CANDIDATE_PACKAGE}@${CANDIDATE_VERSION}`]: { dependencies: { 'dep-a': 'link:../../injected' } },
          'dep-a@1.0.0': {},
        },
      }),
    })
    expect(() => verifyDesktopImCandidate(dir)).toThrow(/outside the reviewed snapshot/u)
  })

  it('rejects a lockfile that is not lockfileVersion 9.0', () => {
    const { dir, lock } = writeFixture()
    const version6 = lock.replace('lockfileVersion: \'9.0\'', 'lockfileVersion: \'6.0\'')
    const descriptor = {
      ...readImCandidateDescriptorFile(dir),
      lockSha256: createHash('sha256').update(version6).digest('hex'),
    }
    writeFileSync(join(dir, IM_CANDIDATE_LOCKFILE), version6)
    writeFileSync(join(dir, 'candidate.json'), `${JSON.stringify(descriptor, undefined, 2)}\n`)
    expect(() => verifyDesktopImCandidate(dir)).toThrow(/lockfileVersion must be 9.0/u)
  })

  it('rejects an importer whose dependency set omits the candidate package', () => {
    const { dir, lock } = writeFixture()
    const renamed = lock.replace(`      '${IM_CANDIDATE_PACKAGE}':`, '      \'@xmanrui/other\':')
    const descriptor = {
      ...readImCandidateDescriptorFile(dir),
      lockSha256: createHash('sha256').update(renamed).digest('hex'),
    }
    writeFileSync(join(dir, IM_CANDIDATE_LOCKFILE), renamed)
    writeFileSync(join(dir, 'candidate.json'), `${JSON.stringify(descriptor, undefined, 2)}\n`)
    expect(() => verifyDesktopImCandidate(dir)).toThrow(/do not match the manifest/u)
  })

  it('rejects a lockfile describing more than the root importer', () => {
    const { dir, lock } = writeFixture()
    // A second importer must be rejected even when the bytes are re-pinned to match.
    const withSecondImporter = lock.replace(
      `        version: ${CANDIDATE_VERSION}`,
      `        version: ${CANDIDATE_VERSION}\n\n  nested/child:\n    dependencies: {}`,
    )
    const descriptor = {
      ...readImCandidateDescriptorFile(dir),
      lockSha256: createHash('sha256').update(withSecondImporter).digest('hex'),
    }
    writeFileSync(join(dir, IM_CANDIDATE_LOCKFILE), withSecondImporter)
    writeFileSync(join(dir, 'candidate.json'), `${JSON.stringify(descriptor, undefined, 2)}\n`)
    expect(() => verifyDesktopImCandidate(dir)).toThrow(/exactly the root importer/u)
  })

  it('rejects an archive whose bytes do not match the pinned integrity', () => {
    const { dir } = writeFixture()
    writeFileSync(join(dir, ARCHIVE_FILE), gzipSync(Buffer.from('not the reviewed archive')))
    expect(() => verifyDesktopImCandidate(dir)).toThrow(/archive integrity/u)
  })

  it('rejects a gzipped payload that is not a tar with the packed manifest', () => {
    const archive = gzipSync(Buffer.alloc(1024))
    const fixture = writeFixture({ archive })
    const descriptor = {
      ...fixture.descriptor,
      integrity: `sha512-${createHash('sha512').update(archive).digest('base64')}`,
    }
    writeFileSync(join(fixture.dir, 'candidate.json'), `${JSON.stringify(descriptor, undefined, 2)}\n`)
    expect(() => verifyDesktopImCandidate(fixture.dir)).toThrow(/omits package\/package\.json/u)
  })

  it('rejects an archive packing a different package identity', () => {
    const archive = archiveBytes({ name: '@xmanrui/other', version: CANDIDATE_VERSION })
    const fixture = writeFixture({ archive })
    // Re-pin integrity so only the packed identity differs.
    const descriptor = {
      ...fixture.descriptor,
      integrity: `sha512-${createHash('sha512').update(archive).digest('base64')}`,
    }
    writeFileSync(join(fixture.dir, 'candidate.json'), `${JSON.stringify(descriptor, undefined, 2)}\n`)
    expect(() => verifyDesktopImCandidate(fixture.dir)).toThrow(/different package identity/u)
  })

  it('rejects a manifest that declares anything but the exact candidate pin', () => {
    const { dir } = writeFixture()
    const manifestPath = join(dir, IM_CANDIDATE_MANIFEST_FILE)
    // A changed manifest fails at capture: the importer check runs on the same read that the
    // review pin would hash, so the drift is reported as a manifest violation either way.
    writeFileSync(manifestPath, JSON.stringify({ name: 'x', private: true, dependencies: { [IM_CANDIDATE_PACKAGE]: `^${CANDIDATE_VERSION}` } }))
    expect(() => verifyDesktopImCandidate(dir)).toThrow(/exactly/u)
    const descriptor = {
      ...readImCandidateDescriptorFile(dir),
      manifestSha256: createHash('sha256').update(readFileSync(manifestPath)).digest('hex'),
    }
    writeFileSync(join(dir, 'candidate.json'), `${JSON.stringify(descriptor, undefined, 2)}\n`)
    expect(() => verifyDesktopImCandidate(dir)).toThrow(/exactly/u)
  })

  it('rejects a manifest that is not a private package', () => {
    const { dir } = writeFixture()
    const manifestPath = join(dir, IM_CANDIDATE_MANIFEST_FILE)
    writeFileSync(manifestPath, JSON.stringify({ name: 'x', dependencies: { [IM_CANDIDATE_PACKAGE]: CANDIDATE_VERSION } }))
    const descriptor = {
      ...readImCandidateDescriptorFile(dir),
      manifestSha256: createHash('sha256').update(readFileSync(manifestPath)).digest('hex'),
    }
    writeFileSync(join(dir, 'candidate.json'), `${JSON.stringify(descriptor, undefined, 2)}\n`)
    expect(() => verifyDesktopImCandidate(dir)).toThrow(/private package/u)
  })

  it('rejects a changed workspace file as reviewed-byte drift', () => {
    const { dir } = writeFixture()
    writeFileSync(join(dir, IM_CANDIDATE_WORKSPACE_FILE), 'packages:\n  - .\nallowBuilds:\n  sharp: true\n')
    expect(() => verifyDesktopImCandidate(dir)).toThrow(/workspace settings changed since review/u)
  })

  it('rejects malformed descriptors before reading inputs', () => {
    const { dir } = writeFixture()
    writeFileSync(join(dir, 'candidate.json'), '{"schemaVersion":2}\n')
    expect(() => verifyDesktopImCandidate(dir)).toThrow(/invalid descriptor/u)
  })
})

describe('im candidate input capture', () => {
  it('rejects a FIFO input before opening it', () => {
    const { dir } = writeFixture()
    rmSync(join(dir, ARCHIVE_FILE))
    execFileSync('mkfifo', [join(dir, ARCHIVE_FILE)])
    expect(() => readCandidateInputs(dir, readImCandidateDescriptorFile(dir))).toThrow(/not a regular file/u)
  })

  it('rejects a symlink input without following it', () => {
    const { dir } = writeFixture()
    const target = join(tempRoot(), 'elsewhere.tgz')
    writeFileSync(target, 'attacker')
    rmSync(join(dir, ARCHIVE_FILE))
    execFileSync('ln', ['-s', target, join(dir, ARCHIVE_FILE)])
    expect(() => readCandidateInputs(dir, readImCandidateDescriptorFile(dir))).toThrow(/not a regular file/u)
  })

  it('rejects an input over the byte cap', () => {
    const { dir } = writeFixture()
    const descriptor = readImCandidateDescriptorFile(dir)
    const archivePath = join(dir, ARCHIVE_FILE)
    rmSync(archivePath)
    writeFileSync(archivePath, Buffer.alloc(IM_CANDIDATE_MAX_BYTES + 1))
    expect(() => readCandidateInputs(dir, descriptor)).toThrow(/exceeds/u)
  })
})

describe('im candidate staging', () => {
  it('writes the verified bytes into a private stage directory', () => {
    const { dir, archive, lock } = writeFixture()
    const stage = join(tempRoot(), 'stage')
    const staged = stageDesktopImCandidate(verifyDesktopImCandidate(dir), stage)
    expect(readFileSync(staged).equals(archive)).toBe(true)
    expect(readFileSync(join(stage, IM_CANDIDATE_LOCKFILE), 'utf8')).toBe(lock)
    expect(readFileSync(join(stage, IM_CANDIDATE_MANIFEST_FILE)).byteLength).toBeGreaterThan(0)
    expect(readFileSync(join(stage, IM_CANDIDATE_WORKSPACE_FILE)).byteLength).toBeGreaterThan(0)
    expect(readFileSync(join(stage, IM_CANDIDATE_LOCKFILE)).byteLength).toBe(lock.length)
    expect(statSync(stage).mode & 0o777).toBe(0o700)
  })

  it('never overwrites an existing staged file', () => {
    const { dir } = writeFixture()
    const stage = join(tempRoot(), 'stage')
    stageDesktopImCandidate(verifyDesktopImCandidate(dir), stage)
    expect(() => stageDesktopImCandidate(verifyDesktopImCandidate(dir), stage)).toThrow(/already contains/u)
    const preexisting = join(tempRoot(), 'pre')
    mkdirSync(preexisting, { recursive: true })
    writeFileSync(join(preexisting, ARCHIVE_FILE), 'imposter')
    expect(() => stageDesktopImCandidate(verifyDesktopImCandidate(dir), preexisting)).toThrow(/already contains/u)
    expect(readFileSync(join(preexisting, ARCHIVE_FILE), 'utf8')).toBe('imposter')
  })

  it('creates nested stage directories and writes owner-only files', () => {
    const { dir } = writeFixture()
    const stage = join(tempRoot(), 'outer', 'inner')
    const staged = stageDesktopImCandidate(verifyDesktopImCandidate(dir), stage)
    expect(statSync(stage).mode & 0o777).toBe(0o700)
    expect(statSync(staged).mode & 0o777).toBe(0o600)
    expect(statSync(join(stage, IM_CANDIDATE_LOCKFILE)).mode & 0o777).toBe(0o600)
  })

  it('stages the captured batch even when the source file changes afterward', () => {
    const { dir, archive } = writeFixture()
    const descriptor = readImCandidateDescriptorFile(dir)
    const inputs = readCandidateInputs(dir, descriptor)
    const candidate = verifyDesktopImCandidate(dir, inputs)
    // After capture and verification the source archive is made unreadable and replaced;
    // staging still writes the verified batch, proving no second read occurred.
    const archivePath = join(dir, ARCHIVE_FILE)
    chmodSync(archivePath, 0o000)
    const stage = join(tempRoot(), 'stage')
    const staged = stageDesktopImCandidate(candidate, stage)
    expect(readFileSync(staged).equals(archive)).toBe(true)
    chmodSync(archivePath, 0o600)
  })

  it('verifying mutated inputs after capture fails instead of staging', () => {
    const { dir } = writeFixture()
    const descriptor = readImCandidateDescriptorFile(dir)
    const inputs = readCandidateInputs(dir, descriptor)
    writeFileSync(join(dir, IM_CANDIDATE_LOCKFILE), 'lockfileVersion: \'9.0\'\n')
    expect(() => verifyDesktopImCandidate(dir, inputs)).not.toThrow()
    expect(() => verifyDesktopImCandidate(dir)).toThrow(/lockfile bytes changed since review/u)
  })
})

describe('im candidate release gate', () => {
  const eligible: ImCandidateDescriptor = {
    schemaVersion: 1,
    package: IM_CANDIDATE_PACKAGE,
    version: CANDIDATE_VERSION,
    integrity: 'sha512-' + 'A'.repeat(86) + '==',
    archiveUrl: `https://registry.npmjs.org/${IM_CANDIDATE_PACKAGE}/-/${ARCHIVE_FILE}`,
    archiveFile: ARCHIVE_FILE,
    lockSha256: 'a'.repeat(64),
    manifestSha256: 'b'.repeat(64),
    workspaceSha256: 'c'.repeat(64),
    releaseEligible: true,
    blockers: [],
  }

  it('refuses an ineligible candidate and names the blockers', () => {
    const { descriptor } = writeFixture({ blockers: ['no DSH 0.2.2 compatibility declaration', 'retains group messages'] })
    expect(() => { assertImCandidateReleaseEligible(descriptor, false) }).toThrow(/not release-eligible/u)
    expect(() => { assertImCandidateReleaseEligible(descriptor, false) }).toThrow(/no DSH 0.2.2 compatibility declaration/u)
    expect(() => { assertImCandidateReleaseEligible(descriptor, false) }).toThrow(/--allow-ineligible-im-candidate/u)
  })

  it('passes eligible candidates and the explicit ineligible opt-in', () => {
    expect(() => { assertImCandidateReleaseEligible(eligible, false) }).not.toThrow()
    const { descriptor } = writeFixture()
    expect(() => { assertImCandidateReleaseEligible(descriptor, true) }).not.toThrow()
  })

  it('keeps packaging opt-in only through the parsed invocation', () => {
    const parsed = parseDesktopPackageInvocation(
      ['mac-arm64', '--with-im-candidate', '--allow-ineligible-im-candidate'], 'darwin', 'arm64')
    expect(parsed.imCandidate).toBe(true)
    expect(parsed.allowIneligibleImCandidate).toBe(true)
    expect(parseDesktopPackageInvocation(['mac-arm64'], 'darwin', 'arm64').imCandidate).toBe(false)
    expect(() => parseDesktopPackageInvocation(['mac-arm64', '--allow-ineligible-im-candidate'], 'darwin', 'arm64'))
      .toThrow(/requires --with-im-candidate/u)
  })

  it('maps the darwin x64 host to the mac-x64 release target', () => {
    expect(parseDesktopPackageInvocation([], 'darwin', 'x64').target.name).toBe('mac-x64')
  })

  it('lets a packaging request consult the gate without packaging', () => {
    const { descriptor } = writeFixture()
    expect(() => { assertDesktopImCandidateRequest(
      { imCandidate: true, allowIneligibleImCandidate: false }, descriptor) }).toThrow(/not release-eligible/u)
    expect(() => { assertDesktopImCandidateRequest(
      { imCandidate: true, allowIneligibleImCandidate: true }, descriptor) }).not.toThrow()
    expect(() => { assertDesktopImCandidateRequest(
      { imCandidate: false, allowIneligibleImCandidate: false }) }).not.toThrow()
  })
})

describe('im candidate package set', () => {
  function coreInput(root: string): string {
    const input = join(root, 'packed')
    mkdirSync(input, { recursive: true })
    const packs: [string, Record<string, unknown>, Record<string, string>][] = [
      ['dsh', { name: '@deepseek-ai/dsh', version: '0.2.2', dependencies: { '@deepseek-ai/dsh-base': '0.2.2' } }, { 'lib/index.js': '// dsh\n' }],
      ['dsh-desktop-host', { name: '@deepseek-ai/dsh-desktop-host', version: '0.2.2' }, { 'lib/index.js': '// host\n', 'lib/cli.js': '// cli\n' }],
      ['dsh-base', { name: '@deepseek-ai/dsh-base', version: '0.2.2' }, { 'lib/index.js': '// base\n' }],
      ['dsh-tako', { name: '@deepseek-ai/dsh-tako', version: '0.2.2' }, { 'lib/index.js': '// tako\n' }],
    ]
    for (const [pack, manifest, files] of packs) {
      const source = join(root, `src-${pack}`)
      mkdirSync(join(source, 'package', 'lib'), { recursive: true })
      writeFileSync(join(source, 'package', 'package.json'), JSON.stringify(manifest))
      for (const [file, body] of Object.entries(files)) {
        writeFileSync(join(source, 'package', file), body)
      }
      execFileSync('tar', ['-czf', join(input, `${pack}.tgz`), '-C', source, 'package'])
    }
    return input
  }

  it('adds the verified candidate beside the core closure when opted in', async () => {
    const { dir } = writeFixture({ releaseEligible: true })
    const root = tempRoot()
    const output = join(root, 'package-set')
    prepareDesktopPackageSet([coreInput(root)], output, { platform: 'darwin', arch: 'arm64' })
    const without = parseDesktopCorePackageSet(JSON.parse(readFileSync(join(output, DESKTOP_PACKAGE_SET_FILE), 'utf8')))
    expect(without.packages.some(record => record.name === IM_CANDIDATE_PACKAGE)).toBe(false)
    const imCandidate = await loadImCandidatePackage(dir)
    prepareDesktopPackageSet([coreInput(root)], output, { platform: 'darwin', arch: 'arm64' }, imCandidate)
    const set = parseDesktopCorePackageSet(JSON.parse(readFileSync(join(output, DESKTOP_PACKAGE_SET_FILE), 'utf8')))
    const record = set.packages.find(entry => entry.name === IM_CANDIDATE_PACKAGE)
    expect(record?.version).toBe(CANDIDATE_VERSION)
    expect(readFileSync(join(output, DESKTOP_PACKAGES_DIR, record!.file)).byteLength).toBe(record!.bytes)
    const names = set.packages.map(entry => entry.name)
    expect(names).toEqual([...names].sort((left, right) => left.localeCompare(right)))
  })

  it('refuses the default ineligible candidate before writing the package set', () => {
    const descriptor = readImCandidateDescriptorFile(join(import.meta.dirname, '..', IM_CANDIDATE_DIR))
    expect(descriptor.releaseEligible).toBe(false)
    expect(() => { assertImCandidateReleaseEligible(descriptor, false) }).toThrow(/not release-eligible/u)
  })
})
