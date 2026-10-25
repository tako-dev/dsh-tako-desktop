/**
 * Repository paths that exist in the official DeepSeek Harness repository but are deleted in the
 * DSH Tako fork: the official GitHub Actions workflows, issue and review automation, and the
 * specs that read those workflow files. Inherited official Markdown keeps linking to them, so the
 * relative-link check accepts a missing target under one of these paths instead of requiring an
 * edit to every inherited document on each upstream merge.
 */

const REMOVED_UPSTREAM_PREFIXES = [
  '.github/workflows/',
  '.github/issue-management/',
  '.github/review-ownership/',
  '.github/preview-sizing/',
  '.github/ISSUE_TEMPLATE/',
] as const

const REMOVED_UPSTREAM_FILES = new Set([
  '.github/dependabot.yml',
  'scripts/ci-workflow.spec.ts',
  'scripts/ci-compatible-selfhosted.spec.ts',
  'scripts/desktop-package-source.spec.ts',
  'scripts/desktop-publish-workflow.spec.ts',
  'scripts/macos-package-workflow.spec.ts',
  'scripts/preview-workflow.spec.ts',
  'scripts/windows-package-workflow.spec.ts',
  'scripts/tests/ci-master-platforms.spec.ts',
  'scripts/tests/ci-release-selfhosted.spec.ts',
])

/**
 * Whether a repository-relative path names an official automation file the DSH Tako fork deleted.
 * @param path - Forward-slash path relative to the repository root.
 * @returns True when the path is one of the deleted official automation files or under a deleted directory.
 */
export function isRemovedUpstreamPath(path: string): boolean {
  return REMOVED_UPSTREAM_FILES.has(path) || REMOVED_UPSTREAM_PREFIXES.some(prefix => path.startsWith(prefix))
}
