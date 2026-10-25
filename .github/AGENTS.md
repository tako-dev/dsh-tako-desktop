# AGENTS.md — GitHub Actions (DSH Tako)

This fork runs two workflows; the official DeepSeek Harness workflows, issue and review automation, and Dependabot are deleted, and inherited links to them pass [`verify-md-links`](../scripts/tako-removed-upstream-paths.ts).

- [ci.yml](workflows/ci.yml) runs on pushes to `main` and on pull requests: frozen install, typecheck, lint, and the Desktop and Tako vitest subset on `ubuntu-latest`.
- [release.yml](workflows/release.yml) runs on `v*` tags and `workflow_dispatch`: it requires the tag to equal `TAKO_DESKTOP_VERSION`, builds the signed macOS arm64 and unsigned Windows x64 installers, and publishes them to one GitHub Release. Only its `publish` job holds `contents: write`. Keep Windows steps on `pwsh` and macOS steps on bash; shared logic lives in [tako-release.mjs](../apps/desktop/scripts/tako-release.mjs), which uses only Node.js built-ins.

The release process, secrets, and upstream-merge procedure are in the [maintainer guide](../docs/tako/maintainers.md).
