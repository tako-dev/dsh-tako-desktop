# DSH Tako Maintainer Guide

English | [中文](maintainers.zh.md)

This guide is for maintainers of [tako-dev/dsh-tako-desktop](https://github.com/tako-dev/dsh-tako-desktop): the development environment, local packaging, releases, signing secrets, following new official DeepSeek Harness versions, and the points that separate DSH Tako from the official build. For usage, see the [user guide](user-guide.md).

## Development environment

- Node.js 24 (`engines` in `package.json` allows `^22.19.0 || >=24.0.0`; packaging and CI use 24).
- pnpm at the root `package.json` `packageManager` version (`pnpm@11.28.5`), selected automatically by Corepack or `pnpm/action-setup`.
- macOS packaging needs the Xcode command line tools; Windows packaging needs Visual Studio C++ Build Tools, a Windows SDK, Python, and PowerShell (GitHub's `windows-latest` has them).

```sh
pnpm install
pnpm run dev:desktop      # build, then launch the desktop app in development mode
pnpm run typecheck
pnpm run lint
```

CI ([ci.yml](../../.github/workflows/ci.yml)) runs on pushes to `main` and on pull requests: typecheck, lint, and this vitest subset: `apps/desktop` (including `apps/desktop-host`), `packages/tako`, `ui-brand-official`, `ui-settings-account`, `ui-conversation`, `ui-layout`, `app-boot`, and the script tests this fork adds. The official repository owns the full suite; run the relevant tests locally when you change other packages.

## Local packaging

| Command | Output | Notes |
|---|---|---|
| `pnpm --filter @deepseek-ai/dsh-desktop run package:mac:arm64:unsigned` | `apps/desktop/.desktop-build/targets/mac-arm64/unsigned-artifacts/DSH-Tako-<version>-mac-arm64-unsigned.dmg` | Ignores `.env.macos`; ad-hoc signature; no automatic updates |
| `pnpm run package:desktop:mac:arm64` | dmg, zip, zip.blockmap, and `latest-mac.yml` under `…/mac-arm64/artifacts/` | Signed and notarized; needs `apps/desktop/.env.macos` (template `.env.macos.example`) |
| `pnpm run package:desktop:win:x64:unsigned-release` (Windows host) | `DSH-Tako-<version>-win-x64.exe`, `.exe.blockmap`, and `latest.yml` under `…/win-x64/unsigned-artifacts/` | No code signing, but embeds the GitHub update feed; needs `apps/desktop/.env.windows` to exist (it may be empty) |

Add `--check` to any command to validate only the configuration and toolchain. Packaging logs are in `apps/desktop/.desktop-build/packaging-runs/`. See the [packaging guide](../../apps/desktop/packaging/README.md) for details.

## Version

The single source of the application version is `TAKO_DESKTOP_VERSION` in [tako-desktop-identity.mjs](../../apps/desktop/scripts/tako-desktop-identity.mjs). Packaging writes it into installer names, `latest*.yml`, and the app's `app.getVersion()`. The `version` in `apps/desktop/package.json` and the root `package.json` is the bundled DSH runtime version (for example `0.2.1-rc.2`); it follows upstream and must not become the Tako version, and packaging checks that the two agree. The `DSH_TAKO_DESKTOP_VERSION` environment variable is for local experiments only; the release workflow never sets it.

Releases accept only stable `MAJOR.MINOR.PATCH` versions: the update channel is `latest`, and electron-builder refuses to publish a prerelease on it.

## Release process

1. Change `TAKO_DESKTOP_VERSION` (for example to `0.1.1`), open a PR, and merge it into `main` after CI passes.
2. Tag the merged commit and push the tag: `git tag v0.1.1 && git push tako v0.1.1` (`tako` is the remote for this repository).
3. [release.yml](../../.github/workflows/release.yml) runs:
   - `plan` requires the tag to equal `v` + `TAKO_DESKTOP_VERSION` and fails immediately otherwise.
   - `macos` (`macos-15`, arm64) imports the certificate, signs, and notarizes when all six Apple secrets exist, and fails listing the missing ones otherwise.
   - `windows` (`windows-latest`) builds the unsigned NSIS installer with the GitHub update feed.
   - `publish`, after both platforms succeed, writes `SHA256SUMS.txt` and the release notes (template [.github/tako-release-notes.md](../../.github/tako-release-notes.md)) and creates the release with `gh release create <tag> --verify-tag`; when the release already exists it replaces the assets with `gh release upload --clobber` and leaves the notes alone. Only this job has `contents: write`.
4. Check the release assets: `DSH-Tako-<version>-mac-arm64.dmg`, `.zip`, `.zip.blockmap`, `latest-mac.yml`, `DSH-Tako-<version>-win-x64.exe`, `.exe.blockmap`, `latest.yml`, and `SHA256SUMS.txt`.

Running Release manually from the Actions page (`workflow_dispatch`) takes an existing tag and these options:

- `dry_run` builds and keeps the Actions artifacts (`release-mac-arm64`, `release-win-x64`), shows the checksums and notes in the run summary, and creates or changes no release.
- `allow_unsigned_mac` publishes `DSH-Tako-<version>-mac-arm64-unsigned.dmg` when Apple secrets are missing. That build has no zip or `latest-mac.yml` and no automatic updates; Mac users of a signed version who check for updates manually see a failure because `latest-mac.yml` is missing.

Rerunning a failed workflow is idempotent: assets with the same names replace the existing ones.

## Secrets

Configure them under the repository's Settings → Secrets and variables → Actions. The macOS job fails when any is missing, unless a manual run selects `allow_unsigned_mac`.

| Secret | Content | Use |
|---|---|---|
| `APPLE_CERTIFICATE` | The Developer ID Application certificate and private key exported as `.p12`, then base64-encoded (`base64 -i cert.p12`) | Decoded to a temporary file used as `CSC_LINK`; the official packaging script imports it into its own temporary keychain for signing |
| `APPLE_CERTIFICATE_PASSWORD` | The password chosen when exporting the `.p12` | `CSC_KEY_PASSWORD` |
| `APPLE_ID` | The Apple ID email used for notarization | `APPLE_ID` (notarytool) |
| `APPLE_PASSWORD` | An app-specific password for that Apple ID (generated at appleid.apple.com), not the sign-in password | `APPLE_APP_SPECIFIC_PASSWORD` (notarytool) |
| `APPLE_TEAM_ID` | The 10-character Apple Developer Team ID, matching the certificate | `APPLE_TEAM_ID` and `DSH_DESKTOP_MACOS_TEAM_ID` |
| `KEYCHAIN_PASSWORD` | Any random string | Creates a throwaway keychain that reads the `Developer ID Application: Name (TEAMID)` identity from the certificate and is deleted immediately |

The workflow writes these values to `apps/desktop/.env.macos` (mode 600, deleted when the job ends), which the official signing path reads: `DSH_DESKTOP_APP_ID=tech.shiroha.dsh-tako`, `DSH_DESKTOP_MACOS_SIGNING_IDENTITY` (the identity without the `Developer ID Application: ` prefix), `DSH_DESKTOP_MACOS_TEAM_ID`, `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID`. Notarization uses notarytool with an Apple ID, an app-specific password, and the Team ID. Windows needs no secrets. Publishing uses the workflow's own `GITHUB_TOKEN`.

## Automatic updates

The app reads GitHub Releases through electron-updater (`provider: github`, `owner: tako-dev`, `repo: dsh-tako-desktop`, channel `latest`). This configuration lives in the packaged `app-update.yml`: the packaging scripts write and verify it on macOS, and electron-builder writes it on Windows. The app enables updates only when `app-update.yml` exists.

- macOS updates require an app signed with Developer ID and notarized; Squirrel.Mac refuses to install updates for an unsigned app, so unsigned Mac builds embed no update feed.
- The Windows installer is unsigned and its `app-update.yml` has no publisher name, so electron-updater checks only the SHA-512 in `latest.yml`, not an update signature.

The mandatory-update policy (`dshMandatoryUpdatePolicy`) is disabled: without `DSH_DESKTOP_MANDATORY_UPDATE_*_ORIGIN` and `DSH_DESKTOP_MANDATORY_UPDATE_CONFIG`, packaging embeds no policy and the app makes no policy requests. Setting either enables the official policy and requires a complete configuration; see [desktop-policy-environment.mjs](../../apps/desktop/scripts/desktop-policy-environment.mjs) and the [desktop README](../../apps/desktop/README.md#mandatory-update-policy).

## Following official releases

The official repository's remote is `origin`, and its release tags look like `dsh-v0.2.1-rc.3`.

1. `git fetch origin --tags`, create a branch, and `git merge dsh-v<version>`. Resolve conflicts in favor of the official code, then reapply the Tako behavior on the new APIs.
2. Official `.github/` workflows, `dependabot.yml`, and issue templates that the official side added or changed reappear (modify/delete conflicts or new files): `git rm` all of them and keep this repository's `ci.yml`, `release.yml`, `AGENTS.md`, and `tako-release-notes.md`. Also delete new official specs that read workflow files, and add their paths to [tako-removed-upstream-paths.ts](../../scripts/tako-removed-upstream-paths.ts).
3. The `version` in the root `package.json` and `apps/desktop/package.json` follows upstream. Remove any new script such as `test:approval-policy` or run-gates gate that depends on deleted directories.
4. Run `pnpm install` to update the lockfile, then `pnpm run typecheck`, `pnpm run lint`, the CI vitest subset, and `pnpm run test:docs`; finally run `package:mac:arm64:unsigned` locally and launch it to check the welcome screen, sign-in, and branding.
5. Name the official version in the merge commit message, for example `merge: follow official DSH 0.2.1-rc.3`.

Conflict hotspots:

- Packaging: `apps/desktop/scripts/electron-builder-config.mjs`, `package-target.ts`, `package-macos.ts`, `desktop-package-environment.mjs`, `desktop-release-environment.mjs`, `desktop-policy-environment.mjs`, `desktop-build-paths.mjs`, `macos-app-update-config.mjs`, `smoke-packaged-runtime.ts`, `prepare-cli.ts`, and `.env.*.example`.
- Desktop main process: `apps/desktop/src/main.ts`, `locale.ts`, `welcome-*.ts`, `update-coordinator.ts`, `command-installation.ts`, `command-management.ts`, `host-process.ts`, `browser-guests.ts`, and the expected output under `apps/desktop/tests/expected/`.
- Installer and resources: `apps/desktop/installer/`, `apps/desktop/cli/`, the icons in `apps/desktop/resources/`, and `apps/desktop/renderer/`.
- Client and boot: `packages/client/ui-brand-official`, `ui-settings-account`, `ui-settings-models`, `ui-sidebar-browser`, `ui-conversation`, `ui-layout`, `ui-plugin-manager`, `packages/boot/app-boot/src/profile.ts`, and `packages/boot/plugin-manager`.
- Repository: the DSH Tako section at the top of `README.md`/`README.zh.md`, `package.json` scripts, `pnpm-lock.yaml`, `scripts/run-gates.ts`, `scripts/verify-md-links.ts`, and `tsconfig.*.json`.

## Branding and isolation points

| Item | Value | Location |
|---|---|---|
| Product name (app bundle, menus, Electron userData directory) | `DSH Tako` | `tako-desktop-identity.mjs`, `src/tako-identity.ts` |
| App ID (the official `com.deepseek.harness` is refused) | `tech.shiroha.dsh-tako` | `tako-desktop-identity.mjs`, `desktop-release-environment.mjs` |
| URL scheme | `dsh-tako://` | Same as above |
| Terminal command | `dsh-tako` (macOS `/usr/local/bin/dsh-tako`, Windows `dsh-tako.cmd`) | `apps/desktop/cli/`, `src/tako-identity.ts`, `command-path.ps1` |
| Data directory | `~/.dsh-tako` (when `DSH_HOME` is unset) | `src/tako-identity.ts` |
| Installer file name prefix | `DSH-Tako` | `tako-desktop-identity.mjs` |
| Packaged `package.json` name (updater cache `dsh-tako-desktop-updater`) | `dsh-tako-desktop` | Same as above |
| Update source | GitHub Releases `tako-dev/dsh-tako-desktop` | `TAKO_DESKTOP_GITHUB_PUBLISH` |
| Icons, welcome screen, installer text | Tako icons and copy | `apps/desktop/resources/`, `renderer/`, `installer/strings.nsh`, `src/locale.ts` |
| Web client brand and title | DSH Tako | `packages/client/ui-brand-official`, `ui-layout` |

## Cannot-break profile invariants (2026-10-26)

0.1.5 stripped `@deepseek-ai/dsh-tako` from the desktop profile before npm `dsh-tako` was installed. Tako models and tools disappeared. These checks must stay green:

| Lock | Where |
|---|---|
| Shipped `tako` template still lists `@deepseek-ai/dsh-tako` after `dsh-web-app` | `apps/desktop/tests/tako-profile-invariants.spec.ts` |
| `createPluginProfile` keeps that bundle and does **not** pin npm `dsh-tako` | same file + `scripts/smoke-runtime.ts` (packaging) |
| `applyRelease` restores a profile that had the bundle stripped | `tako-profile-invariants.spec.ts` |
| `project-manager.ts` / `main.ts` do not import `tako-npm-plugin` or call `installTakoPlugin` | `tako-profile-invariants.spec.ts` |
| Welcome still treats settings `ns === 'tako'` as Tako | `tako-profile-invariants.spec.ts`, `welcome-host.spec.ts` |

Do not skip, delete, or weaken those tests. Do not drop the bundled Tako layer in `applyRelease` / `createPluginProfile` unless the npm plugin is already installed and a live upgrade has been verified on a real DSH Tako profile. `apps/desktop/src/tako-npm-plugin.ts` still contains the 0.1.5 strip helpers; leaving that file in the tree is not permission to wire it back.

## Known limitations

- The Windows installer is not code-signed: installation and updates may trigger SmartScreen, and enterprise policy may block it.
- Unsigned macOS builds (`allow_unsigned_mac`) have no automatic updates, and users must allow them under Privacy & Security.
- The mandatory-update policy is disabled, so upgrades cannot be enforced.
- Only macOS arm64 and Windows x64 are released; there are no Intel Mac or Linux installers.
- Only stable versions are released; prereleases need a separate update channel design.
- Automatic updates need access to GitHub; restricted networks need manual downloads.
- CI runs only the Tako- and desktop-related test subset; the rest of the official suite does not run in this repository.
