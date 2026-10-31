# DSH Tako release history

English | [中文](release-log.zh.md)

The [GitHub Releases page](https://github.com/tako-dev/dsh-tako-desktop/releases) is the authoritative source for published versions, installer assets and checksums. Each new release includes its merged-PR summary, comparison with the preceding release, exact build source and bundled DSH version. Application updates select the latest compatible stable release directly; installing intermediate versions is not required.

## v0.1.45 — 2026-10-31

- Native recovery adds Copy diagnostic report path. It copies the complete path, keeps recovery open and permits retry after a clipboard failure.
- Source: [PR #31](https://github.com/tako-dev/dsh-tako-desktop/pull/31), [issue #29](https://github.com/tako-dev/dsh-tako-desktop/issues/29). Bundled DSH: 0.2.1-rc.5.
- [Release and installers](https://github.com/tako-dev/dsh-tako-desktop/releases/tag/v0.1.45) · [Changes since v0.1.44](https://github.com/tako-dev/dsh-tako-desktop/compare/v0.1.44...v0.1.45).

## v0.1.44 — 2026-10-30

- Restore account-page startup by declaring the credentials dependency; update permission turn-state access without disabling lint checks.
- Source: [PR #30](https://github.com/tako-dev/dsh-tako-desktop/pull/30), [issue #29](https://github.com/tako-dev/dsh-tako-desktop/issues/29). Bundled DSH: 0.2.1-rc.5.
- [Release and installers](https://github.com/tako-dev/dsh-tako-desktop/releases/tag/v0.1.44).

## v0.1.41 — 2026-10-30

- Workbench plugin sign-in refreshes the desktop sidebar quota using the changed API key. Plugin 0.5.14 uses local credentials and refreshes the sidebar after key changes.
- Source: [issue #19](https://github.com/tako-dev/dsh-tako-desktop/issues/19) · [Release](https://github.com/tako-dev/dsh-tako-desktop/releases/tag/v0.1.41).

## v0.1.39 — 2026-10-30

- New sessions retain the last selected permission mode, including full permissions. Automatic review remains session-local.
- Bundled DSH: 0.2.1-rc.2 → 0.2.1-rc.5. The v0.1.38 packaging attempt failed because Tako package versions did not match; its tag was not moved. v0.1.39 was published.
- Source: [issue #15](https://github.com/tako-dev/dsh-tako-desktop/issues/15) · [Release](https://github.com/tako-dev/dsh-tako-desktop/releases/tag/v0.1.39).
