# AGENTS.md — GitHub Actions (DSH Tako)

This fork runs two workflows; the official DeepSeek Harness workflows, issue and review automation, and Dependabot are deleted, and inherited links to them pass [`verify-md-links`](../scripts/tako-removed-upstream-paths.ts).

- [ci.yml](workflows/ci.yml) runs on pushes to `main` and on pull requests: frozen install, typecheck, lint, and the Desktop and Tako vitest subset on `ubuntu-latest`.
- [release.yml](workflows/release.yml) runs on `v*` tags and `workflow_dispatch`: it requires the tag to equal `TAKO_DESKTOP_VERSION`, builds the signed macOS arm64 and unsigned Windows x64 installers, and publishes them to one GitHub Release. Only its `publish` job holds `contents: write`. Keep Windows steps on `pwsh` and macOS steps on bash; shared logic lives in [tako-release.mjs](../apps/desktop/scripts/tako-release.mjs), which uses only Node.js built-ins.

The release process, secrets, and upstream-merge procedure are in the [maintainer guide](../docs/tako/maintainers.md).

## Installer verification

Two checks exist and only one of them runs in CI, which is easy to get wrong:

- `windows-release-install-smoke.ps1` runs inside the `release.yml` Windows job against the **installer that is about to be published**: silent `/S` install into a private directory, installed-tree and `FileVersion` checks, uninstall-entry and Start Menu shortcut checks, one launch, silent uninstall, then no leftover directory, registry entry or shortcut. A failure here stops the release before the upload step.
- `pnpm test:installer` (`scripts/test-windows-installer.mjs`) drives the installer **UI** through UIAutomation, screenshots every page, and exercises silent/uninstall/upgrade data-retention cases. It builds its own throwaway installer with a dummy payload, needs an interactive Windows x64 desktop, takes long, and is therefore not part of `ci.yml`; run it by hand on a Windows machine before touching `installer/*.nsh`, `scripts/installer.nsh`, or the NSIS section of `scripts/electron-builder-config.mjs`. It is also the only check that covers the UI pages, localization strings and uninstall data retention.

