/**
 * Integrity-locked optional packaging candidate for the third-party `@xmanrui/dsh-im` plugin.
 *
 * The candidate directory carries a reviewed descriptor, an importer manifest, a standalone
 * pnpm workspace file, a frozen lockfile snapshot, and the pinned npm archive (fetched on
 * demand). Verification hashes the lockfile's raw bytes before parsing them, then checks the
 * importer against the manifest, the resolved snapshot closure, and the archive integrity and
 * packed identity. Staging writes the same captured bytes; nothing is re-read from disk after
 * verification, so a filesystem swap between checking and staging cannot pass unnoticed.
 *
 * The descriptor carries `releaseEligible: true`: maintainers exempted the candidate's four
 * documented blockers on 2026-11-22 after evaluation and distribute the plugin with Desktop
 * installers. The gate itself stays: a descriptor with `releaseEligible: false` refuses to
 * package unless the operator repeats the explicit `--allow-ineligible-im-candidate` opt-in on
 * the release or package-set command.
 */

import { createHash } from 'node:crypto'
import {
  chmodSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  closeSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { parseArgs } from 'node:util'
import { basename, join, resolve } from 'node:path'
import * as yaml from 'js-yaml'

/** Package the candidate pins. */
export const IM_CANDIDATE_PACKAGE = '@xmanrui/dsh-im'

/** Candidate identity directory inside the Desktop application tree. */
export const IM_CANDIDATE_DIR = 'optional-plugins/dsh-im'

/** Reviewed candidate descriptor filename. */
export const IM_CANDIDATE_DESCRIPTOR_FILE = 'candidate.json'

/** Importer manifest filename the lockfile was generated from. */
export const IM_CANDIDATE_MANIFEST_FILE = 'package.json'

/** Frozen dependency snapshot reviewed and hash-pinned as raw bytes. */
export const IM_CANDIDATE_LOCKFILE = 'pnpm-lock.yaml'

/** Install-time workspace settings staged beside the lockfile. */
export const IM_CANDIDATE_WORKSPACE_FILE = 'pnpm-workspace.yaml'

/** Largest single candidate input read into memory. */
export const IM_CANDIDATE_MAX_BYTES = 32 * 1024 * 1024

/** Failure classes reported by candidate verification and staging. */
export type ImCandidateCode =
  | 'candidate-descriptor'
  | 'candidate-manifest'
  | 'candidate-input'
  | 'candidate-lock'
  | 'candidate-archive'
  | 'candidate-eligibility'
  | 'candidate-stage'

/** One structured candidate failure; `code` identifies which review pin rejected. */
export class ImCandidateError extends Error {
  readonly code: ImCandidateCode

  constructor(code: ImCandidateCode, message: string) {
    super(message)
    this.name = 'ImCandidateError'
    this.code = code
  }
}

/** Reviewed identity and release gate for the optional plugin candidate. */
export interface ImCandidateDescriptor {
  readonly schemaVersion: 1
  readonly package: string
  readonly version: string
  /** npm dist.integrity of the pinned archive, `sha512-<base64>`. */
  readonly integrity: string
  /** npm registry URL `fetch` downloads the archive from. */
  readonly archiveUrl: string
  /** Archive filename inside the candidate directory. */
  readonly archiveFile: string
  /** SHA-256 of the reviewed lockfile's raw bytes; mismatch means the snapshot changed. */
  readonly lockSha256: string
  /** SHA-256 of the reviewed importer manifest's raw bytes. */
  readonly manifestSha256: string
  /** SHA-256 of the reviewed workspace settings file's raw bytes. */
  readonly workspaceSha256: string
  /** False while documented blockers keep the candidate out of shipping installers. */
  readonly releaseEligible: boolean
  /** Human-readable reasons `releaseEligible` is false; surfaced verbatim in refusals. */
  readonly blockers: readonly string[]
}

/** Dependency specifiers one importer manifest declares. */
export interface ImCandidateManifest {
  readonly name: string
  readonly dependencies: Readonly<Record<string, string>>
}

/** Candidate input bytes captured once for verification and staging. */
export interface ImCandidateInputs {
  readonly manifestBytes: Buffer
  readonly lockBytes: Buffer
  readonly workspaceBytes: Buffer
  readonly archiveBytes: Buffer
  readonly manifest: ImCandidateManifest
}

/** Verified candidate ready to report or stage. */
export interface VerifiedImCandidate {
  readonly descriptor: ImCandidateDescriptor
  readonly inputs: ImCandidateInputs
  /** Locked package entries the snapshot closure resolves. */
  readonly lockedPackages: number
  /** Regular files inside the verified archive. */
  readonly archiveFiles: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function candidatePath(directory: string, file: string): string {
  return join(directory, file)
}

/**
 * Parse the reviewed descriptor without trusting its shape.
 * @param value - Parsed `candidate.json` content.
 * @returns The normalized descriptor.
 */
export function parseImCandidateDescriptor(value: unknown): ImCandidateDescriptor {
  if (!isRecord(value) || value.schemaVersion !== 1
    || typeof value.package !== 'string' || value.package !== IM_CANDIDATE_PACKAGE
    || typeof value.version !== 'string' || value.version === ''
    || typeof value.integrity !== 'string' || !/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(value.integrity)
    || typeof value.archiveUrl !== 'string' || !value.archiveUrl.startsWith('https://')
    || typeof value.archiveFile !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.tgz$/u.test(value.archiveFile)
    || typeof value.lockSha256 !== 'string' || !/^[0-9a-f]{64}$/u.test(value.lockSha256)
    || typeof value.manifestSha256 !== 'string' || !/^[0-9a-f]{64}$/u.test(value.manifestSha256)
    || typeof value.workspaceSha256 !== 'string' || !/^[0-9a-f]{64}$/u.test(value.workspaceSha256)
    || typeof value.releaseEligible !== 'boolean'
    || !Array.isArray(value.blockers) || !value.blockers.every(blocker => typeof blocker === 'string')) {
    throw new ImCandidateError('candidate-descriptor', 'desktop im candidate: invalid descriptor')
  }
  return {
    schemaVersion: 1,
    package: value.package,
    version: value.version,
    integrity: value.integrity,
    archiveUrl: value.archiveUrl,
    archiveFile: value.archiveFile,
    lockSha256: value.lockSha256,
    manifestSha256: value.manifestSha256,
    workspaceSha256: value.workspaceSha256,
    releaseEligible: value.releaseEligible,
    blockers: value.blockers,
  }
}

/**
 * Read only the reviewed descriptor; the release gate uses it before touching the archive.
 * @param directory - Candidate identity directory.
 * @returns The parsed descriptor.
 */
export function readImCandidateDescriptorFile(directory: string): ImCandidateDescriptor {
  const path = candidatePath(directory, IM_CANDIDATE_DESCRIPTOR_FILE)
  let value: unknown
  try {
    value = JSON.parse(readRegularFile(path, IM_CANDIDATE_MAX_BYTES).toString('utf8'))
  } catch (error) {
    if (error instanceof ImCandidateError) throw error
    throw new ImCandidateError('candidate-descriptor', `desktop im candidate: failed to read ${path}: ${String(error)}`)
  }
  return parseImCandidateDescriptor(value)
}

/**
 * Read one candidate input as a bounded regular file without following symlinks.
 * A non-regular entry fails on `lstat` before any blocking open, so a FIFO cannot stall reads.
 * @param path - Absolute file path.
 * @param maxBytes - Per-file byte ceiling.
 * @returns The complete file bytes.
 */
function readRegularFile(path: string, maxBytes: number): Buffer {
  const stat = lstatSync(path)
  if (!stat.isFile()) {
    throw new ImCandidateError('candidate-input', `desktop im candidate: ${basename(path)} is not a regular file`)
  }
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    if (!fstatSync(descriptor).isFile()) {
      throw new ImCandidateError('candidate-input', `desktop im candidate: ${basename(path)} is not a regular file`)
    }
    const chunks: Buffer[] = []
    let total = 0
    const chunk = Buffer.alloc(Math.min(1024 * 1024, maxBytes + 1))
    for (;;) {
      const count = readSync(descriptor, chunk, 0, chunk.byteLength, null)
      if (count === 0) break
      total += count
      if (total > maxBytes) {
        throw new ImCandidateError('candidate-input', `desktop im candidate: ${basename(path)} exceeds ${String(maxBytes)} bytes`)
      }
      chunks.push(Buffer.from(chunk.subarray(0, count)))
    }
    return Buffer.concat(chunks, total)
  } finally {
    closeSync(descriptor)
  }
}

/**
 * Parse the importer manifest and require the exact candidate pin.
 * @param manifest - Parsed `package.json` bytes.
 * @param descriptor - Reviewed descriptor to pin against.
 * @returns The validated manifest projection.
 */
export function verifyImCandidateManifest(manifest: unknown, descriptor: ImCandidateDescriptor): ImCandidateManifest {
  if (!isRecord(manifest) || manifest.name === undefined || manifest.private !== true) {
    throw new ImCandidateError('candidate-manifest', 'desktop im candidate: importer manifest must be a private package')
  }
  const dependencies = manifest.dependencies
  if (!isRecord(dependencies)) {
    throw new ImCandidateError('candidate-manifest', 'desktop im candidate: importer manifest has no dependencies')
  }
  const entries = Object.entries(dependencies)
  if (entries.length !== 1 || entries[0]![0] !== descriptor.package || entries[0]![1] !== descriptor.version) {
    throw new ImCandidateError('candidate-manifest',
      `desktop im candidate: importer must depend on exactly ${descriptor.package}@${descriptor.version}`)
  }
  return { name: String(manifest.name), dependencies: { [descriptor.package]: descriptor.version } }
}

/**
 * Capture the manifest, workspace file, lockfile, and archive exactly once.
 * Verification and staging consume these bytes; the files are never re-read afterward.
 * @param directory - Candidate identity directory.
 * @param descriptor - Reviewed descriptor selecting the archive filename.
 * @returns The captured inputs with the parsed manifest.
 */
export function readCandidateInputs(directory: string, descriptor: ImCandidateDescriptor): ImCandidateInputs {
  const manifestBytes = readRegularFile(candidatePath(directory, IM_CANDIDATE_MANIFEST_FILE), IM_CANDIDATE_MAX_BYTES)
  const workspaceBytes = readRegularFile(candidatePath(directory, IM_CANDIDATE_WORKSPACE_FILE), IM_CANDIDATE_MAX_BYTES)
  const lockBytes = readRegularFile(candidatePath(directory, IM_CANDIDATE_LOCKFILE), IM_CANDIDATE_MAX_BYTES)
  const archiveBytes = readRegularFile(candidatePath(directory, descriptor.archiveFile), IM_CANDIDATE_MAX_BYTES)
  let manifestValue: unknown
  try {
    manifestValue = JSON.parse(manifestBytes.toString('utf8'))
  } catch (error) {
    throw new ImCandidateError('candidate-manifest', `desktop im candidate: importer manifest is not JSON: ${String(error)}`)
  }
  return { manifestBytes, workspaceBytes, lockBytes, archiveBytes, manifest: verifyImCandidateManifest(manifestValue, descriptor) }
}

/**
 * Hash the lockfile's raw bytes before parsing and validate the reviewed snapshot.
 * Byte drift fails as `candidate-lock` with `lockfile bytes changed since review` before YAML
 * ever parses; only a byte-identical file is parsed, so the structural checks describe exactly
 * the dependency graph a reviewer inspected.
 * @param lockBytes - Captured lockfile bytes.
 * @param manifest - Validated importer manifest.
 * @param descriptor - Reviewed descriptor carrying `lockSha256`.
 * @returns The locked package count in the verified snapshot closure.
 */
export function verifyImCandidateLock(lockBytes: Buffer, manifest: ImCandidateManifest, descriptor: ImCandidateDescriptor): number {
  if (sha256(lockBytes) !== descriptor.lockSha256) {
    throw new ImCandidateError('candidate-lock', 'desktop im candidate: lockfile bytes changed since review')
  }
  let parsed: unknown
  try {
    parsed = yaml.load(lockBytes.toString('utf8'))
  } catch (error) {
    throw new ImCandidateError('candidate-lock', `desktop im candidate: lockfile is not valid YAML: ${String(error)}`)
  }
  if (!isRecord(parsed) || String(parsed.lockfileVersion) !== '9.0') {
    throw new ImCandidateError('candidate-lock', 'desktop im candidate: lockfileVersion must be 9.0')
  }
  const importers = parsed.importers
  if (!isRecord(importers)) {
    throw new ImCandidateError('candidate-lock', 'desktop im candidate: lockfile has no importers')
  }
  const importerKeys = Object.keys(importers)
  const importer = importers['.']
  if (importerKeys.length !== 1 || importerKeys[0] !== '.' || !isRecord(importer)) {
    throw new ImCandidateError('candidate-lock', 'desktop im candidate: lockfile must describe exactly the root importer')
  }
  const importerDependencies = importer.dependencies
  if (!isRecord(importerDependencies)) {
    throw new ImCandidateError('candidate-lock', 'desktop im candidate: importer has no dependencies')
  }
  const importerNames = Object.keys(importerDependencies)
  const manifestNames = Object.keys(manifest.dependencies)
  if (importerNames.length !== manifestNames.length || !manifestNames.every(name => importerNames.includes(name))) {
    throw new ImCandidateError('candidate-lock', 'desktop im candidate: importer dependencies do not match the manifest')
  }
  const packages = parsed.packages
  const snapshots = parsed.snapshots
  if (!isRecord(packages) || !isRecord(snapshots)) {
    throw new ImCandidateError('candidate-lock', 'desktop im candidate: lockfile has no packages or snapshots')
  }
  const stripPeers = (resolved: string): string => resolved.replace(/\(.*\)$/u, '')
  const seen = new Set<string>()
  const walk = (name: string, resolved: string): void => {
    const id = `${name}@${resolved}`
    if (seen.has(id)) return
    seen.add(id)
    const snapshot = snapshots[id]
    if (!isRecord(snapshot)) {
      throw new ImCandidateError('candidate-lock',
        `desktop im candidate: lockfile resolves ${id} outside the reviewed snapshot`)
    }
    const entry = packages[`${name}@${stripPeers(resolved)}`]
    if (!isRecord(entry) || !isRecord(entry.resolution) || typeof entry.resolution.integrity !== 'string') {
      throw new ImCandidateError('candidate-lock',
        `desktop im candidate: lockfile resolves ${id} without a reviewed registry integrity`)
    }
    for (const section of ['dependencies', 'optionalDependencies'] as const) {
      const members = snapshot[section]
      if (members === undefined) continue
      if (!isRecord(members)) {
        throw new ImCandidateError('candidate-lock', `desktop im candidate: invalid ${section} in snapshot ${id}`)
      }
      for (const [member, value] of Object.entries(members)) {
        if (typeof value !== 'string') {
          throw new ImCandidateError('candidate-lock', `desktop im candidate: invalid resolution for ${member} in ${id}`)
        }
        const suffix = value.includes('(') ? value.slice(value.indexOf('(')) : ''
        const stripped = value.replace(/\(.*\)$/u, '')
        const separator = stripped.lastIndexOf('@')
        const target = separator > 0 ? stripped.slice(0, separator) : member
        const version = separator > 0 ? `${stripped.slice(separator + 1)}${suffix}` : `${stripped}${suffix}`
        walk(target, version)
      }
    }
  }
  for (const name of manifestNames) {
    const row = importerDependencies[name]
    if (!isRecord(row) || row.specifier !== manifest.dependencies[name] || typeof row.version !== 'string'
      || stripPeers(row.version) !== manifest.dependencies[name]) {
      throw new ImCandidateError('candidate-lock', `desktop im candidate: importer resolution for ${name} is not exact`)
    }
    walk(name, row.version)
  }
  return seen.size
}

const TAR_BLOCK = 512

/**
 * Extract one member and count regular files inside an npm archive held in memory.
 * @param archiveBytes - Captured `.tgz` bytes.
 * @param member - Archive-relative member to return.
 * @returns The member bytes and the regular-file count.
 */
function readTarMember(archiveBytes: Buffer, member: string): { bytes: Buffer; files: number } {
  let tar: Buffer
  try {
    tar = gunzipSync(archiveBytes)
  } catch (error) {
    throw new ImCandidateError('candidate-archive', `desktop im candidate: archive is not a gzip stream: ${String(error)}`)
  }
  let offset = 0
  let pendingName: string | undefined
  let found: Buffer | undefined
  let files = 0
  const fail = (reason: string): never => {
    throw new ImCandidateError('candidate-archive', `desktop im candidate: ${reason}`)
  }
  while (offset + TAR_BLOCK <= tar.byteLength) {
    const header = tar.subarray(offset, offset + TAR_BLOCK)
    if (header.every(byte => byte === 0)) break
    const nameField = header.subarray(0, 100)
    const zero = nameField.indexOf(0)
    const name = (zero === -1 ? nameField : nameField.subarray(0, zero)).toString('utf8')
    const sizeText = header.subarray(124, 136).toString('utf8').replace(/\0.*$/u, '').trim()
    const size = Number.parseInt(sizeText === '' ? '0' : sizeText, 8)
    if (!Number.isSafeInteger(size) || size < 0) fail('archive has a malformed member size')
    const type = String.fromCharCode(header[156]!)
    const prefixField = header.subarray(345, 500)
    const prefixZero = prefixField.indexOf(0)
    const isUstar = header.subarray(257, 262).toString('utf8') === 'ustar'
    const prefix = isUstar && prefixZero !== 0
      ? `${(prefixZero === -1 ? prefixField : prefixField.subarray(0, prefixZero)).toString('utf8')}/`
      : ''
    const dataStart = offset + TAR_BLOCK
    const dataEnd = dataStart + size
    if (dataEnd > tar.byteLength) fail('archive member overruns the tarball')
    const data = tar.subarray(dataStart, dataEnd)
    if (type === 'L' || type === 'x') {
      // GNU long name and per-member PAX headers supply the next member's name.
      if (type === 'L') {
        pendingName = data.toString('utf8').replace(/\0.*$/u, '')
      } else {
        let cursor = 0
        while (cursor < data.byteLength) {
          const space = data.indexOf(0x20, cursor)
          if (space === -1) break
          const length = Number.parseInt(data.subarray(cursor, space).toString('utf8'), 10)
          if (!Number.isSafeInteger(length) || length <= 0 || cursor + length > data.byteLength) break
          const body = data.subarray(space + 1, cursor + length - 1).toString('utf8')
          if (body.startsWith('path=')) pendingName = body.slice('path='.length)
          cursor += length
        }
      }
    } else if (type !== 'g') {
      const fullName = pendingName ?? `${prefix}${name}`
      pendingName = undefined
      if (type === '0' || type === '\0' || type === '7') {
        files += 1
        if (fullName === member) found = Buffer.from(data)
      }
    }
    offset = dataStart + Math.ceil(size / TAR_BLOCK) * TAR_BLOCK
  }
  return { bytes: found ?? fail(`archive omits ${member}`), files }
}

/**
 * Verify the captured archive against the pinned integrity and the identity it packs.
 * @param inputs - Captured candidate inputs.
 * @param descriptor - Reviewed descriptor pinning integrity, name, and version.
 * @returns The regular-file count inside the archive.
 */
export function verifyImCandidateArchive(inputs: ImCandidateInputs, descriptor: ImCandidateDescriptor): number {
  const digest = `sha512-${createHash('sha512').update(inputs.archiveBytes).digest('base64')}`
  if (digest !== descriptor.integrity) {
    throw new ImCandidateError('candidate-archive', 'desktop im candidate: archive integrity does not match the descriptor')
  }
  const member = readTarMember(inputs.archiveBytes, 'package/package.json')
  let manifest: unknown
  try {
    manifest = JSON.parse(member.bytes.toString('utf8'))
  } catch (error) {
    throw new ImCandidateError('candidate-archive', `desktop im candidate: packed manifest is not JSON: ${String(error)}`)
  }
  if (!isRecord(manifest) || manifest.name !== descriptor.package || manifest.version !== descriptor.version) {
    throw new ImCandidateError('candidate-archive', 'desktop im candidate: archive packs a different package identity')
  }
  return member.files
}

/**
 * Run every review pin over one captured input set.
 * @param directory - Candidate identity directory.
 * @param inputs - Previously captured inputs; captured here when omitted.
 * @returns The verified candidate.
 */
export function verifyDesktopImCandidate(directory: string, inputs?: ImCandidateInputs): VerifiedImCandidate {
  const descriptor = readImCandidateDescriptorFile(directory)
  const captured = inputs ?? readCandidateInputs(directory, descriptor)
  if (sha256(captured.manifestBytes) !== descriptor.manifestSha256) {
    throw new ImCandidateError('candidate-manifest', 'desktop im candidate: manifest bytes changed since review')
  }
  if (sha256(captured.workspaceBytes) !== descriptor.workspaceSha256) {
    throw new ImCandidateError('candidate-manifest', 'desktop im candidate: workspace settings changed since review')
  }
  const lockedPackages = verifyImCandidateLock(captured.lockBytes, captured.manifest, descriptor)
  const archiveFiles = verifyImCandidateArchive(captured, descriptor)
  return { descriptor, inputs: captured, lockedPackages, archiveFiles }
}

/**
 * Enforce the release gate: an ineligible candidate refuses to package without the explicit opt-in.
 * @param descriptor - Reviewed descriptor carrying `releaseEligible` and its blockers.
 * @param allowIneligible - Explicit `--allow-ineligible-im-candidate` operator opt-in.
 */
export function assertImCandidateReleaseEligible(descriptor: ImCandidateDescriptor, allowIneligible: boolean): void {
  if (descriptor.releaseEligible) return
  if (!allowIneligible) {
    throw new ImCandidateError('candidate-eligibility',
      `desktop im candidate: ${descriptor.package}@${descriptor.version} is not release-eligible: ${descriptor.blockers.join('; ')}; repeat with --allow-ineligible-im-candidate to override`)
  }
  process.stderr.write(`desktop im candidate: packaging ${descriptor.package}@${descriptor.version} despite releaseEligible=false: ${descriptor.blockers.join('; ')}\n`)
}

/**
 * Write the verified candidate inputs into a private stage directory.
 * The same bytes verification accepted are the bytes staged; existing files are never
 * overwritten, so a staged identity cannot be silently replaced.
 * @param candidate - Verified candidate with captured inputs.
 * @param stageDir - Destination directory, created mode 0700.
 * @returns The staged archive path.
 */
export function stageDesktopImCandidate(candidate: VerifiedImCandidate, stageDir: string): string {
  mkdirSync(stageDir, { recursive: true })
  chmodSync(stageDir, 0o700)
  const files: readonly [string, Buffer][] = [
    [candidate.descriptor.archiveFile, candidate.inputs.archiveBytes],
    [IM_CANDIDATE_MANIFEST_FILE, candidate.inputs.manifestBytes],
    [IM_CANDIDATE_LOCKFILE, candidate.inputs.lockBytes],
    [IM_CANDIDATE_WORKSPACE_FILE, candidate.inputs.workspaceBytes],
  ]
  for (const [file, bytes] of files) {
    const destination = join(stageDir, file)
    try {
      writeFileSync(destination, bytes, { flag: 'wx', mode: 0o600 })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new ImCandidateError('candidate-stage', `desktop im candidate: stage already contains ${file}`)
      }
      throw error
    }
  }
  return join(stageDir, candidate.descriptor.archiveFile)
}

/**
 * Download the pinned archive and store it under the reviewed filename.
 * An existing file is verified rather than replaced; a corrupt file fails loudly instead of
 * being silently refetched.
 * @param directory - Candidate identity directory.
 * @returns The archive path.
 */
export async function fetchImCandidateArchive(directory: string): Promise<string> {
  const descriptor = readImCandidateDescriptorFile(directory)
  const destination = candidatePath(directory, descriptor.archiveFile)
  if (existsSync(destination)) {
    const bytes = readRegularFile(destination, IM_CANDIDATE_MAX_BYTES)
    if (`sha512-${createHash('sha512').update(bytes).digest('base64')}` !== descriptor.integrity) {
      throw new ImCandidateError('candidate-archive', 'desktop im candidate: archive integrity does not match the descriptor')
    }
    return destination
  }
  const response = await fetch(descriptor.archiveUrl)
  if (!response.ok) {
    throw new ImCandidateError('candidate-archive',
      `desktop im candidate: archive fetch failed with ${String(response.status)}`)
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.byteLength > IM_CANDIDATE_MAX_BYTES) {
    throw new ImCandidateError('candidate-archive', `desktop im candidate: archive exceeds ${String(IM_CANDIDATE_MAX_BYTES)} bytes`)
  }
  const digest = `sha512-${createHash('sha512').update(bytes).digest('base64')}`
  if (digest !== descriptor.integrity) {
    throw new ImCandidateError('candidate-archive', 'desktop im candidate: downloaded archive integrity does not match the descriptor')
  }
  const temporary = `${destination}.download`
  writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o600 })
  try {
    renameSync(temporary, destination)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST' || existsSync(destination)) {
      throw new ImCandidateError('candidate-archive', `desktop im candidate: ${descriptor.archiveFile} appeared during fetch`)
    }
    throw error
  }
  return destination
}

const CANDIDATE_ROOT = resolve(import.meta.dirname, '..', IM_CANDIDATE_DIR)

async function main(argv: readonly string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      dir: { type: 'string', default: CANDIDATE_ROOT },
      'allow-ineligible': { type: 'boolean', default: false },
    },
  })
  const command = positionals[0] ?? 'verify'
  if (command === 'fetch') {
    const path = await fetchImCandidateArchive(values.dir)
    process.stdout.write(`desktop im candidate: fetched ${path}\n`)
    return
  }
  if (command === 'verify') {
    const candidate = verifyDesktopImCandidate(values.dir)
    const { descriptor } = candidate
    process.stdout.write(`desktop im candidate: ${descriptor.package}@${descriptor.version} verified; `
      + `${String(candidate.lockedPackages)} locked packages, ${String(candidate.archiveFiles)} archive files, `
      + `releaseEligible=${String(descriptor.releaseEligible)}\n`)
    if (!descriptor.releaseEligible) {
      process.stdout.write(`desktop im candidate: blockers: ${descriptor.blockers.join('; ')}\n`)
    }
    return
  }
  if (command === 'stage') {
    const stageDir = positionals[1]
    if (stageDir === undefined || positionals.length > 2) {
      throw new ImCandidateError('candidate-stage', 'desktop im candidate: stage requires exactly one output directory')
    }
    const candidate = verifyDesktopImCandidate(values.dir)
    assertImCandidateReleaseEligible(candidate.descriptor, values['allow-ineligible'])
    const staged = stageDesktopImCandidate(candidate, resolve(stageDir))
    process.stdout.write(`desktop im candidate: staged ${staged}\n`)
    return
  }
  throw new ImCandidateError('candidate-stage', `desktop im candidate: unknown command ${JSON.stringify(command)}; expected fetch, verify, or stage`)
}

// Node 24.0 and 24.1 lack import.meta.main, so run detection compares the invoked file path.
if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`${error instanceof ImCandidateError ? `${error.code}: ` : ''}${message}\n`)
    process.exitCode = 1
  })
}
