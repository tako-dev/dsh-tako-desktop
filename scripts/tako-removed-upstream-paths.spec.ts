import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { isRemovedUpstreamPath } from './tako-removed-upstream-paths.ts'
import { findViolations } from './verify-md-links.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

it('names the deleted official automation paths only', () => {
  expect(isRemovedUpstreamPath('.github/workflows/ci-master.yml')).toBe(true)
  expect(isRemovedUpstreamPath('.github/issue-management/README.md')).toBe(true)
  expect(isRemovedUpstreamPath('scripts/ci-workflow.spec.ts')).toBe(true)
  expect(isRemovedUpstreamPath('.github/AGENTS.md')).toBe(false)
  expect(isRemovedUpstreamPath('scripts/run-gates.ts')).toBe(false)
  expect(isRemovedUpstreamPath('docs/workflows/ci.yml')).toBe(false)
})

it('accepts inherited links to deleted official workflows and still rejects other missing targets', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-tako-links-'))
  roots.push(root)
  mkdirSync(join(root, 'docs'))
  writeFileSync(join(root, 'docs/guide.md'), '[CI](../.github/workflows/ci-master.yml) and [gone](../scripts/missing.ts)\n')
  expect(findViolations(join(root, 'docs/guide.md'), undefined, root).map(violation => violation.url)).toEqual(['../scripts/missing.ts'])
})
