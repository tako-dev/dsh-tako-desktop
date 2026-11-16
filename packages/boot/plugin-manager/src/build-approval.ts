/** Approve pnpm's pending dependency scripts in the current profile's workspace settings. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isAlias, isMap, isNode, isScalar, isSeq, parseDocument, visit } from 'yaml'
import { ManagementFailure } from './failure.ts'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'

/** Value pnpm leaves for a build script that still needs a decision. */
const UNDECIDED_BUILD = 'set this to true or false'

/** Where a non-interactive run names the build scripts it skipped. */
const IGNORED_BUILDS = /\bIgnored build scripts: (.+)/

async function readPolicy(dir: string) {
  let text: string
  try { text = await readFile(join(dir, 'pnpm-workspace.yaml'), 'utf8') }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    text = '{}\n'
  }
  const document = parseDocument(text)
  if (document.errors[0] !== undefined) throw document.errors[0]
  if (!isMap(document.contents)) throw new Error('pnpm-workspace.yaml must be a YAML mapping')
  const builds = document.get('allowBuilds')
  if (builds !== undefined && !isMap(builds)) throw new Error('allowBuilds must be a YAML mapping')
  visit(builds ?? null, (_key, node) => {
    if (isAlias(node) || (isNode(node) && 'anchor' in node && node.anchor)) {
      throw new Error('allowBuilds must not contain YAML anchors or aliases')
    }
  })
  const keys = isMap(builds) ? builds.items.flatMap(({ key }) =>
    isScalar(key) && typeof key.value === 'string' ? [key.value] : []) : []
  const pending = isMap(builds) ? builds.items.flatMap(({ key, value }) =>
    isScalar(key) && typeof key.value === 'string' && !/[*?]/.test(key.value)
      && isScalar(value) && value.value === UNDECIDED_BUILD ? [key.value] : []) : []
  return { document, pending, keys }
}

async function reportedBuildSelectors(dir: string, output: string): Promise<string[]> {
  const reported = ignoredBuildNames(output)
  if (reported.length === 0) return []
  let text: string
  try { text = await readFile(join(dir, 'node_modules', '.modules.yaml'), 'utf8') }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return reported
  }
  const modules = parseDocument(text)
  if (modules.errors[0] !== undefined) throw modules.errors[0]
  if (!isMap(modules.contents)) throw new Error('node_modules/.modules.yaml must be a YAML mapping')
  const pending = modules.get('pendingBuilds')
  if (pending === undefined) return reported
  if (!isSeq(pending)) throw new Error('node_modules/.modules.yaml pendingBuilds must be a string array')
  const selectors: string[] = []
  for (const item of pending.items) {
    if (!isScalar(item) || typeof item.value !== 'string') {
      throw new Error('node_modules/.modules.yaml pendingBuilds must be a string array')
    }
    selectors.push(item.value)
  }
  // pnpm accepts file dependencies only by dependency path, not by the manifest name in our script-blocking diagnostic.
  return reported.flatMap(name => {
    const exact = selectors.filter(selector => selector.startsWith(`${name}@file:`) && !/[*?]/.test(selector))
    return exact.length === 0 ? [name] : exact
  })
}

/**
 * Record the build scripts a failed run reported as ignored, then list every key awaiting a decision.
 *
 * pnpm writes those policy entries itself only when it can prompt, and the
 * manager always runs it non-interactively, so the run's own report is the
 * record that survives. File dependencies retain pnpm's exact pending selector.
 * @param dir Current profile directory.
 * @param output Captured output of the failed run.
 * @returns Exact pnpm approval keys awaiting a build decision; wildcard rules are excluded.
 * @throws If profile settings or pnpm's pending-build metadata cannot be read or parsed; no approvals are written.
 */
export async function recordPendingBuilds(dir: string, output: string): Promise<string[]> {
  const { document, pending, keys } = await readPolicy(dir)
  const known = new Set(keys)
  const added = (await reportedBuildSelectors(dir, output)).filter(name => !known.has(name))
  if (added.length === 0) return pending
  for (const name of added) document.setIn(['allowBuilds', name], UNDECIDED_BUILD)
  await writeFileAtomic(join(dir, 'pnpm-workspace.yaml'), String(document), { mode: 0o600 })
  return [...pending, ...added]
}

/**
 * Read the package names a pnpm run reported as ignored build scripts.
 * @param output Captured output of the run.
 * @returns Exact names in report order; wildcard patterns are excluded.
 */
export function ignoredBuildNames(output: string): string[] {
  const reported = IGNORED_BUILDS.exec(output)?.[1]
  if (reported === undefined) return []
  return reported.split(',').map(name => name.trim()).filter(name => name !== '' && !/[*?]/.test(name))
}

/** Persist approval without running scripts; the caller holds the profile manifest lock.
 * @param dir Current profile directory.
 * @param names Explicit package names from the pending build list.
 * @throws If a name is no longer pending or allowBuilds contains YAML anchors or aliases; no approvals are written.
 */
export async function approveBuilds(dir: string, names: readonly string[]): Promise<void> {
  const { document, pending } = await readPolicy(dir)
  if (names.some(name => !pending.includes(name))) throw new ManagementFailure('stale-approval')
  if (names.length === 0) return
  for (const name of names) document.setIn(['allowBuilds', name], true)
  await writeFileAtomic(join(dir, 'pnpm-workspace.yaml'), String(document), { mode: 0o600 })
}
