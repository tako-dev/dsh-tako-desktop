/**
 * Keep every workspace package inside the build graph a clean checkout compiles.
 *
 * The Host bundle pass (root `tsdown.config.ts`) visits every `vendor/*` and
 * `packages/*\/*` member and bundles its `lib/types/{index,startup}.js`. Only
 * `tsc -b tsconfig.host.json` emits that file for a package without its own
 * tsdown config, so a package left out of the Host Project Reference graph
 * builds only where a stale, gitignored `lib/` survives — never on CI.
 */

import { existsSync, globSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import ts from 'typescript'
import { expect, it } from 'vitest'
import { collectPackageNames, mappedSpecifiers, uncoveredPackages } from './gen-tsconfig-paths.ts'

const root = resolve(import.meta.dirname, '..')

function referencedProjectDirectories(aggregate: string): Set<string> {
  const directories = new Set<string>()
  const visited = new Set<string>()
  const pending = [resolve(root, aggregate)]
  for (let config = pending.pop(); config !== undefined; config = pending.pop()) {
    if (visited.has(config) || !existsSync(config)) continue
    visited.add(config)
    directories.add(dirname(config))
    const read = ts.readConfigFile(config, path => ts.sys.readFile(path))
    if (read.error !== undefined) throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, '\n'))
    const references = (read.config as { references?: Array<{ path: string }> }).references ?? []
    for (const reference of references) {
      const target = resolve(dirname(config), reference.path)
      pending.push(target.endsWith('.json') ? target : resolve(target, 'tsconfig.json'))
    }
  }
  return directories
}

it('compiles every package the Host bundle pass bundles', () => {
  const host = referencedProjectDirectories('tsconfig.host.json')
  const unreached = globSync(['vendor/*/package.json', 'packages/*/*/package.json'], { cwd: root })
    .map(manifest => resolve(root, dirname(manifest)))
    .filter(directory => globSync('tsdown.config.*', { cwd: directory }).length === 0)
    .filter(directory => !host.has(directory))
    .map(directory => relative(root, directory).replaceAll('\\', '/'))
    .sort()
  expect(unreached).toEqual([])
})

it('maps every workspace package to its source in tsconfig.base.json', () => {
  const mapped = mappedSpecifiers(readFileSync(resolve(root, 'tsconfig.base.json'), 'utf8'))
  expect(uncoveredPackages(collectPackageNames(), mapped)).toEqual([])
})
