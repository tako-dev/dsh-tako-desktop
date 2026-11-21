/** Select and copy the local npm tarball closures that supply Desktop dsh and its private Host. */

import { createHash } from 'node:crypto'
import {
  constants,
  copyFileSync,
  globSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import * as yaml from 'js-yaml'
import {
  DESKTOP_HOST_PACKAGE,
  DESKTOP_HOST_RUNTIME_FILES,
  DESKTOP_PACKAGES_DIR,
  DESKTOP_PACKAGE_SET_FILE,
  parseDesktopCorePackageSet,
  type DesktopCorePackageRecord,
} from '../src/core-package-set.ts'
import { capture } from '../../../scripts/release/process.ts'
import { tarballFiles } from '../../../scripts/release/tarball.ts'
import { desktopTargetPlatform, resolveDesktopBuildTarget, resolveDesktopTargetBuildPaths } from './desktop-build-paths.mjs'
import {
  IM_CANDIDATE_DIR,
  assertImCandidateReleaseEligible,
  fetchImCandidateArchive,
  readImCandidateDescriptorFile,
  verifyDesktopImCandidate,
} from './im-candidate.ts'

const DSH_PACKAGE = '@deepseek-ai/dsh'
const TAKO_PACKAGE = '@deepseek-ai/dsh-tako'
const ROOT_PACKAGES = [DSH_PACKAGE, DESKTOP_HOST_PACKAGE, TAKO_PACKAGE] as const
const APP_ROOT = resolve(import.meta.dirname, '..')
const REPOSITORY_ROOT = resolve(APP_ROOT, '..', '..')

/** Opt-in observation-only Windows computer-use bundle; extra root of the package set when requested. */
export const COMPUTER_USE_WIN_PACKAGE = '@deepseek-ai/dsh-desktop-computer-use-win'

const REQUIRED_DEPENDENCY_SECTIONS = ['dependencies', 'peerDependencies'] as const
const OPTIONAL_DEPENDENCY_SECTION = 'optionalDependencies'

/** Packed package information needed to form the local Desktop closure. */
export interface PackedDesktopPackage {
  readonly tarball: string
  readonly manifest: Readonly<Record<string, unknown>>
}

function supportsTarget(manifest: Readonly<Record<string, unknown>>, field: 'os' | 'cpu', target: string): boolean {
  const values = manifest[field]
  if (values === undefined) return true
  if (!Array.isArray(values) || !values.every((value): value is string => typeof value === 'string')) {
    throw new Error(`desktop package set: ${String(manifest.name)} has invalid ${field}`)
  }
  if (values.includes(`!${target}`)) return false
  return values.length === 0 || (values.length === 1 && values[0] === 'any') || values.includes(target)
    || values.every(value => value.startsWith('!'))
}

function dependencyNames(manifest: Readonly<Record<string, unknown>>, section: string): string[] {
  const value = manifest[section]
  if (value === undefined) return []
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`desktop package set: ${String(manifest.name)} has invalid ${section}`)
  }
  return Object.keys(value).sort()
}

/**
 * Select workspace dependencies rooted at dsh and its private Host; npm resolves external packages.
 * Reads the repository workspace manifest and package manifests to distinguish required local packages from npm-resolved externals.
 * @param available - Packed packages indexed by package name.
 * @param target - Platform and architecture of the installer payload.
 * @param extraRoots - Opt-in packages admitted only when their own os/cpu gates admit the target.
 * @returns Selected packages sorted by name.
 */
export function selectDesktopPackageClosure(
  available: ReadonlyMap<string, PackedDesktopPackage>,
  target: ReturnType<typeof desktopTargetPlatform>,
  extraRoots: readonly string[] = [],
): PackedDesktopPackage[] {
  const workspace = yaml.load(readFileSync(join(REPOSITORY_ROOT, 'pnpm-workspace.yaml'), 'utf8')) as { packages: string[] }
  const workspaceNames = new Set(globSync(workspace.packages.map(pattern => `${pattern}/package.json`), { cwd: REPOSITORY_ROOT })
    .map(path => (JSON.parse(readFileSync(join(REPOSITORY_ROOT, path), 'utf8')) as { name: string }).name))
  const selected = new Map<string, PackedDesktopPackage>()
  const visit = (name: string): void => {
    if (selected.has(name)) return
    const packed = available.get(name)
    if (packed === undefined) throw new Error(`desktop package set: packed inputs omit required package ${name}`)
    selected.set(name, packed)
    for (const section of REQUIRED_DEPENDENCY_SECTIONS) {
      for (const dependency of dependencyNames(packed.manifest, section)) {
        if (available.has(dependency)) visit(dependency)
        else if (workspaceNames.has(dependency)) {
          throw new Error(`desktop package set: ${name} requires unpacked package ${dependency}`)
        }
      }
    }
    for (const dependency of dependencyNames(packed.manifest, OPTIONAL_DEPENDENCY_SECTION)) {
      const optional = available.get(dependency)
      if (optional && supportsTarget(optional.manifest, 'os', target.platform)
        && supportsTarget(optional.manifest, 'cpu', target.arch)) visit(dependency)
    }
  }
  for (const name of ROOT_PACKAGES) {
    if (!available.has(name)) throw new Error(`desktop package set: packed inputs omit ${name}`)
    visit(name)
  }
  for (const name of extraRoots) {
    const packed = available.get(name)
    if (packed === undefined) throw new Error(`desktop package set: packed inputs omit ${name}`)
    if (!supportsTarget(packed.manifest, 'os', target.platform) || !supportsTarget(packed.manifest, 'cpu', target.arch)) {
      throw new Error(`desktop package set: ${name} does not support ${target.platform}-${target.arch}; omit it for this target`)
    }
    visit(name)
  }
  return [...selected.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, packed]) => packed)
}

function packedManifest(tarball: string): Record<string, unknown> {
  const value: unknown = JSON.parse(capture('tar', ['-xOzf', tarball, 'package/package.json']))
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`desktop package set: ${tarball} has no package manifest`)
  }
  return value as Record<string, unknown>
}

function packedPackages(inputs: readonly string[]): Map<string, PackedDesktopPackage> {
  const available = new Map<string, PackedDesktopPackage>()
  for (const input of inputs) {
    const tarballs = readdirSync(input).filter(file => file.endsWith('.tgz')).sort()
    if (tarballs.length === 0) throw new Error(`desktop package set: ${input} contains no tarballs`)
    for (const file of tarballs) {
      const tarball = join(input, file)
      const manifest = packedManifest(tarball)
      const name = manifest.name
      if (typeof name !== 'string' || name === '') throw new Error(`desktop package set: ${tarball} has no package name`)
      if (available.has(name)) throw new Error(`desktop package set: duplicate packed package ${name}`)
      available.set(name, { tarball, manifest })
    }
  }
  return available
}

/**
 * Require every private Host file used before the Desktop profile can pass its health check.
 * @param files - Tarball paths rooted at `package/`.
 * @returns Nothing.
 */
export function assertDesktopHostPackageFiles(files: readonly string[]): void {
  const available = new Set(files)
  const missing = DESKTOP_HOST_RUNTIME_FILES
    .map(file => `package/${file}`)
    .filter(file => !available.has(file))
  if (missing.length > 0) {
    throw new Error(`desktop package set: ${DESKTOP_HOST_PACKAGE} tarball omits required file(s): ${missing.join(', ')}`)
  }
}

/** Verified optional plugin candidate staged into the package set beside the core closure. */
export interface ImCandidatePackageInput {
  /** Absolute path of the verified npm archive. */
  readonly tarball: string
  /** Verified archive integrity in `sha512-<base64>` form. */
  readonly integrity: string
  /** Package name the archive packs. */
  readonly name: string
  /** Package version the archive packs. */
  readonly version: string
}

/**
 * Verify the optional IM candidate and return its package-set entry.
 * @param candidateDir - Candidate identity directory.
 * @returns The archive path and identity the verified bytes carry.
 */
export async function loadImCandidatePackage(candidateDir: string): Promise<ImCandidatePackageInput> {
  await fetchImCandidateArchive(candidateDir)
  const candidate = verifyDesktopImCandidate(candidateDir)
  return {
    tarball: join(candidateDir, candidate.descriptor.archiveFile),
    integrity: candidate.descriptor.integrity,
    name: candidate.descriptor.package,
    version: candidate.descriptor.version,
  }
}

/**
 * Prepare a package set from release tarball directories.
 * @param inputs - Release tarball directories.
 * @param output - Destination package-set directory.
 * @param target - Platform and architecture of the installer payload.
 * @param imCandidate - Verified optional candidate to add beside the core closure.
 * @param extraRoots - Opt-in packages admitted only when their own os/cpu gates admit the target.
 */
export function prepareDesktopPackageSet(
  inputs: readonly string[], output: string, target: ReturnType<typeof desktopTargetPlatform>,
  imCandidate?: ImCandidatePackageInput,
  extraRoots: readonly string[] = [],
): void {
  const selected = selectDesktopPackageClosure(packedPackages(inputs), target, extraRoots)
  const host = selected.find(packed => packed.manifest.name === DESKTOP_HOST_PACKAGE)
  if (host === undefined) throw new Error(`desktop package set: selected closure omits ${DESKTOP_HOST_PACKAGE}`)
  assertDesktopHostPackageFiles(tarballFiles(host.tarball))
  rmSync(output, { recursive: true, force: true })
  const packageDir = join(output, DESKTOP_PACKAGES_DIR)
  mkdirSync(packageDir, { recursive: true })
  const records: DesktopCorePackageRecord[] = selected.map((packed) => {
    const name = packed.manifest.name
    const version = packed.manifest.version
    if (typeof name !== 'string' || typeof version !== 'string') {
      throw new Error(`desktop package set: ${packed.tarball} has no package identity`)
    }
    const file = basename(packed.tarball)
    const destination = join(packageDir, file)
    copyFileSync(packed.tarball, destination, constants.COPYFILE_EXCL)
    const body = readFileSync(destination)
    return {
      name,
      version,
      file,
      bytes: statSync(destination).size,
      integrity: `sha512-${createHash('sha512').update(body).digest('base64')}`,
    }
  })
  if (imCandidate !== undefined) {
    const file = basename(imCandidate.tarball)
    const destination = join(packageDir, file)
    copyFileSync(imCandidate.tarball, destination, constants.COPYFILE_EXCL)
    const body = readFileSync(destination)
    if (`sha512-${createHash('sha512').update(body).digest('base64')}` !== imCandidate.integrity) {
      throw new Error(`desktop package set: ${file} integrity changed after verification`)
    }
    records.push({
      name: imCandidate.name,
      version: imCandidate.version,
      file,
      bytes: statSync(destination).size,
      integrity: imCandidate.integrity,
    })
    records.sort((left, right) => left.name.localeCompare(right.name))
  }
  const packageSet = parseDesktopCorePackageSet({ schemaVersion: 1, packages: records })
  writeFileSync(join(output, DESKTOP_PACKAGE_SET_FILE), `${JSON.stringify(packageSet, undefined, 2)}\n`, { mode: 0o600 })
}

async function main(): Promise<void> {
  const buildPaths = resolveDesktopTargetBuildPaths()
  const defaultInputs = [
    buildPaths.packedDsh,
    buildPaths.packedVendor,
    buildPaths.packedLandlock,
  ]
  const { values } = parseArgs({
    options: {
      from: { type: 'string', multiple: true },
      out: { type: 'string' },
      'with-computer-use-win': { type: 'boolean', default: process.env.DSH_DESKTOP_COMPUTER_USE_WIN === '1' },
      'with-im-candidate': { type: 'boolean', default: false },
      'allow-ineligible-im-candidate': { type: 'boolean', default: false },
    },
    allowPositionals: false,
  })
  if (values['allow-ineligible-im-candidate'] && !values['with-im-candidate']) {
    throw new Error('desktop package set: --allow-ineligible-im-candidate requires --with-im-candidate')
  }
  const inputs = (values.from ?? defaultInputs).map(path => resolve(REPOSITORY_ROOT, path))
  const output = values.out === undefined ? buildPaths.packageSet : resolve(REPOSITORY_ROOT, values.out)
  let imCandidate: ImCandidatePackageInput | undefined
  if (values['with-im-candidate']) {
    const candidateDir = resolve(APP_ROOT, IM_CANDIDATE_DIR)
    // The release gate reads the descriptor before any archive or output mutation.
    assertImCandidateReleaseEligible(readImCandidateDescriptorFile(candidateDir), values['allow-ineligible-im-candidate'])
    imCandidate = await loadImCandidatePackage(candidateDir)
  }
  const extraRoots = values['with-computer-use-win'] ? [COMPUTER_USE_WIN_PACKAGE] : []
  prepareDesktopPackageSet(inputs, output, desktopTargetPlatform(resolveDesktopBuildTarget()), imCandidate, extraRoots)
  console.log(`desktop package set: prepared ${output}`)
}

// Node 24.0 and 24.1 lack import.meta.main, so run detection compares the invoked file path.
if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
