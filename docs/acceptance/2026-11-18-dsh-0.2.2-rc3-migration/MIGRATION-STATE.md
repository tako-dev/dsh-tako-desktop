# DSH 0.2.2-rc.3 whole-tree migration — state record

Working record for ticket `ee285afe` (parent `b2b8b38d`). This file tracks an in-progress migration and is not an acceptance record.

## Method

- Upstream target: `refs/tako-migration/f732e412/upstream-0.2.2-rc.3` (`38a6a5c965`, package `0.2.2-rc.3`).
- Merge base: `31cfe2aafe` (upstream `0.2.1-rc.5`); Tako main carries rc.5 content with no ancestry.
- Tako side: `8d0c0248f2` (`ticket/ee285afe` start).
- Procedure: `git read-tree --reset -u <rc.3>`, then `git merge-recursive 31cfe2aafe -- <rc.3> HEAD`. This applies the rc.5→Tako delta (the true Tako patch, 503 files, +14701/−12864) onto the whole upstream rc.3 tree.
- Result tree: 21,121 files; 422 paths differ from rc.3 (the re-ported Tako patch).

## Conflict resolution policy at this checkpoint

127 conflicts (90 UU, 22 UD, 6 DU, 7 AA, 1 UA, 1 AU).

- `UD` (Tako deleted, upstream modified): keep the deletion (Tako CI/issue-management removal).
- `DU` (upstream deleted, Tako modified): keep the Tako file; `packages/core/agent-loop/src/tool-calls.ts` accepted upstream's deletion (Tako delta was one added `turn` field; verify where the exec context now comes from).
- `AA/UA/AU`: `packages/util/official-bundles/*` (upstream rc.3 already ships this package) resolved to the upstream version; Tako-only additions keep the Tako file.
- `UU`: Tako delta ≤ 12 changed lines, or `pnpm-lock.yaml` → upstream version (the change is present upstream); Tako delta > 12 lines → Tako version. Every choice is listed below.

Files where the Tako version was taken wholesale still contain rc.5-era content; the upstream rc.5→rc.3 changes for those files must be merged before this candidate can be called migrated. Files where the upstream version was taken dropped a small Tako delta; each must be re-checked.

## Per-file decisions

TAKE-DELETED(Tako) .github/issue-management/policy.test.mjs
TAKE-DELETED(Tako) .github/review-ownership/README.md
TAKE-DELETED(Tako) .github/review-ownership/check-approval.mjs
TAKE-DELETED(Tako) .github/review-ownership/check-approval.test.mjs
TAKE-DELETED(Tako) .github/workflows/build-exe-for-python-sdk.yml
TAKE-DELETED(Tako) .github/workflows/build-preview-cloudflare.yml
TAKE-DELETED(Tako) .github/workflows/ci-master.yml
TAKE-DELETED(Tako) .github/workflows/desktop-publish.yml
TAKE-DELETED(Tako) .github/workflows/e2e.yml
TAKE-DELETED(Tako) .github/workflows/macos-package.yml
TAKE-DELETED(Tako) .github/workflows/release-publish.yml
TAKE-DELETED(Tako) .github/workflows/weighted-approval.yml
TAKE-DELETED(Tako) .github/workflows/windows-package.yml
TAKE-DELETED(Tako) scripts/ci-compatible-selfhosted.spec.ts
TAKE-DELETED(Tako) scripts/ci-workflow.spec.ts
TAKE-DELETED(Tako) scripts/desktop-package-source.spec.ts
TAKE-DELETED(Tako) scripts/desktop-publish-workflow.spec.ts
TAKE-DELETED(Tako) scripts/macos-package-workflow.spec.ts
TAKE-DELETED(Tako) scripts/preview-workflow.spec.ts
TAKE-DELETED(Tako) scripts/tests/ci-master-platforms.spec.ts
TAKE-DELETED(Tako) scripts/tests/ci-release-selfhosted.spec.ts
TAKE-DELETED(Tako) scripts/windows-package-workflow.spec.ts
TAKE-DELETED(upstream) packages/core/agent-loop/src/tool-calls.ts TAKO_DELTA=1line(turn field)
TAKE-TAKO(added-by-tako) packages/util/official-bundles/src/catalog.generated.ts
TAKE-TAKO(tako-delta=101) apps/desktop/src/welcome-backend.ts
TAKE-TAKO(tako-delta=110) packages/interaction/permission-presets/src/index.ts
TAKE-TAKO(tako-delta=125) apps/desktop/tests/update-coordinator.spec.ts
TAKE-TAKO(tako-delta=140) apps/desktop/src/locale.ts
TAKE-TAKO(tako-delta=18) apps/desktop/README.md
TAKE-TAKO(tako-delta=18) apps/desktop/README.zh.md
TAKE-TAKO(tako-delta=18) packages/client/ui-conversation/tests/skeleton.client.spec.tsx
TAKE-TAKO(tako-delta=18) scripts/optional-bundles.spec.ts
TAKE-TAKO(tako-delta=20) packages/client/ui-settings-account/src/client/AccountMenu.tsx
TAKE-TAKO(tako-delta=21) apps/desktop/src/fatal-recovery.ts
TAKE-TAKO(tako-delta=21) packages/llm/llm-pi-ai/src/adapter.ts
TAKE-TAKO(tako-delta=25) packages/client/ui-plugin-manager/src/client/PluginManagerPage.tsx
TAKE-TAKO(tako-delta=27) apps/desktop/README.i18n.yaml
TAKE-TAKO(tako-delta=31) packages/boot/plugin-manager/src/index.ts
TAKE-TAKO(tako-delta=31) packages/client/ui-settings-general/src/client/index.ts
TAKE-TAKO(tako-delta=35) packages/client/ui-plugin-manager/tests/components.client.spec.tsx
TAKE-TAKO(tako-delta=37) apps/desktop/tests/main-startup.spec.ts
TAKE-TAKO(tako-delta=39) packages/boot/plugin-manager/src/operations.ts
TAKE-TAKO(tako-delta=40) packages/boot/plugin-manager/src/build-approval.ts
TAKE-TAKO(tako-delta=44) apps/desktop-host/tsconfig.json
TAKE-TAKO(tako-delta=44) packages/client/ui-brand-official/src/client/index.ts
TAKE-TAKO(tako-delta=447) .github/workflows/release.yml
TAKE-TAKO(tako-delta=46) apps/desktop/src/host-process.ts
TAKE-TAKO(tako-delta=47) apps/desktop/scripts/macos-app-update-config.mjs
TAKE-TAKO(tako-delta=48) packages/interaction/permission-presets/tests/permission-presets.spec.ts
TAKE-TAKO(tako-delta=50) apps/desktop/scripts/electron-builder-config.mjs
TAKE-TAKO(tako-delta=57) apps/desktop/tests/fatal-recovery.spec.ts
TAKE-TAKO(tako-delta=58) packages/client/ui-brand-official/tests/browser-plugin.client.spec.tsx
TAKE-TAKO(tako-delta=63) apps/desktop/tests/welcome-host.spec.ts
TAKE-TAKO(tako-delta=65) packages/client/ui-settings-account/src/client/index.ts
TAKE-TAKO(tako-delta=71) apps/desktop/src/update-coordinator.ts
TAKE-TAKO(tako-delta=773) .github/workflows/ci.yml
TAKE-TAKO(tako-delta=93) apps/desktop/src/main.ts
TAKE-TAKO(upstream-deleted) apps/desktop/installer/strings.nsh
TAKE-TAKO(upstream-deleted) packages/api/account-controller/src/index.ts
TAKE-TAKO(upstream-deleted) packages/api/account-controller/src/types.ts
TAKE-TAKO(upstream-deleted) packages/api/account-controller/tests/controller.spec.ts
TAKE-TAKO(upstream-deleted) scripts/builtin-plugin-preview.spec.ts
TAKE-UPSTREAM(added-upstream) packages/util/official-bundles/tests/official-bundles.spec.ts
TAKE-UPSTREAM(both-added) packages/util/official-bundles/README.i18n.yaml
TAKE-UPSTREAM(both-added) packages/util/official-bundles/README.md
TAKE-UPSTREAM(both-added) packages/util/official-bundles/README.zh.md
TAKE-UPSTREAM(both-added) packages/util/official-bundles/package.json
TAKE-UPSTREAM(both-added) packages/util/official-bundles/src/bundles.ts
TAKE-UPSTREAM(both-added) packages/util/official-bundles/src/index.ts
TAKE-UPSTREAM(both-added) packages/util/official-bundles/src/plugin-manager.ts
TAKE-UPSTREAM(tako-delta=0) packages/preset/agent-preset/skills/dsh-doc/references/packages.md
TAKE-UPSTREAM(tako-delta=1) packages/util/README.md
TAKE-UPSTREAM(tako-delta=1) packages/util/README.zh.md
TAKE-UPSTREAM(tako-delta=1) scripts/verify-package-readme-model-experience.ts
TAKE-UPSTREAM(tako-delta=10) apps/cli/tests/profile-initialization.spec.ts
TAKE-UPSTREAM(tako-delta=10) scripts/gen-official-bundle-catalog.ts
TAKE-UPSTREAM(tako-delta=101) pnpm-lock.yaml
TAKE-UPSTREAM(tako-delta=11) apps/desktop/.env.macos.example
TAKE-UPSTREAM(tako-delta=11) apps/desktop/.env.windows.example
TAKE-UPSTREAM(tako-delta=12) packages/client/ui-settings-account/src/client/locales.ts
TAKE-UPSTREAM(tako-delta=2) apps/desktop-host/src/index.ts
TAKE-UPSTREAM(tako-delta=2) apps/web/tests/plugin-config.e2e.ts
TAKE-UPSTREAM(tako-delta=2) apps/web/tests/plugin-manager.e2e.ts
TAKE-UPSTREAM(tako-delta=2) packages/boot/app-boot/README.md
TAKE-UPSTREAM(tako-delta=2) packages/boot/app-boot/README.zh.md
TAKE-UPSTREAM(tako-delta=2) packages/experimental/plugin-market-bundle/README.md
TAKE-UPSTREAM(tako-delta=2) packages/experimental/plugin-market-bundle/README.zh.md
TAKE-UPSTREAM(tako-delta=2) scripts/gen-cli-help.ts
TAKE-UPSTREAM(tako-delta=2) scripts/local-bundle-registry.spec.ts
TAKE-UPSTREAM(tako-delta=2) scripts/release/families.ts
TAKE-UPSTREAM(tako-delta=2) scripts/release/installed-product-isolation.ts
TAKE-UPSTREAM(tako-delta=3) apps/cli/src/plugin.ts
TAKE-UPSTREAM(tako-delta=3) scripts/release/families.spec.ts
TAKE-UPSTREAM(tako-delta=3) tsconfig.host.json
TAKE-UPSTREAM(tako-delta=4) apps/desktop/packaging/README.i18n.yaml
TAKE-UPSTREAM(tako-delta=4) apps/desktop/packaging/README.md
TAKE-UPSTREAM(tako-delta=4) apps/desktop/packaging/README.zh.md
TAKE-UPSTREAM(tako-delta=4) docs/i18n/README.i18n.yaml
TAKE-UPSTREAM(tako-delta=4) packages/boot/app-boot/README.i18n.yaml
TAKE-UPSTREAM(tako-delta=4) packages/boot/plugin-manager/README.i18n.yaml
TAKE-UPSTREAM(tako-delta=4) packages/boot/plugin-manager/README.md
TAKE-UPSTREAM(tako-delta=4) packages/boot/plugin-manager/README.zh.md
TAKE-UPSTREAM(tako-delta=4) packages/client/ui-brand-official/README.i18n.yaml
TAKE-UPSTREAM(tako-delta=4) packages/client/ui-layout/src/client/AppFrame.tsx
TAKE-UPSTREAM(tako-delta=4) packages/client/ui-settings-account/README.i18n.yaml
TAKE-UPSTREAM(tako-delta=4) packages/core/tools/src/index.ts
TAKE-UPSTREAM(tako-delta=4) packages/experimental/plugin-market-bundle/README.i18n.yaml
TAKE-UPSTREAM(tako-delta=4) packages/experimental/webworker-packer/README.i18n.yaml
TAKE-UPSTREAM(tako-delta=4) packages/experimental/webworker-packer/README.md
TAKE-UPSTREAM(tako-delta=4) packages/experimental/webworker-packer/README.zh.md
TAKE-UPSTREAM(tako-delta=4) packages/interaction/permission-presets/README.i18n.yaml
TAKE-UPSTREAM(tako-delta=4) packages/util/README.i18n.yaml
TAKE-UPSTREAM(tako-delta=4) scripts/client-build-environment.client.spec.ts
TAKE-UPSTREAM(tako-delta=4) scripts/verify-default-product-isolation.spec.ts
TAKE-UPSTREAM(tako-delta=4) scripts/verify-repository-references.ts
TAKE-UPSTREAM(tako-delta=5) apps/desktop/src/preload-app.ts
TAKE-UPSTREAM(tako-delta=5) apps/desktop/tests/expected/fatal-dialog-with-report-en.txt
TAKE-UPSTREAM(tako-delta=5) apps/desktop/tests/expected/fatal-dialog-with-report-zh-CN.txt
TAKE-UPSTREAM(tako-delta=5) packages/boot/app-boot/tests/profile.spec.ts
TAKE-UPSTREAM(tako-delta=5) packages/experimental/webworker-packer/src/repository.ts
TAKE-UPSTREAM(tako-delta=5) scripts/check-workspace-constraints.ts
TAKE-UPSTREAM(tako-delta=5) tsconfig.base.json
TAKE-UPSTREAM(tako-delta=6) apps/desktop/tests/prepare-package-set.spec.ts
TAKE-UPSTREAM(tako-delta=6) apps/desktop/tsconfig.host.json
TAKE-UPSTREAM(tako-delta=9) .github/AGENTS.md

## Next steps

1. Re-merge upstream rc.5→rc.3 changes into every `TAKE-TAKO` file (especially `apps/desktop/src/*`, `packages/boot/plugin-manager/src/index.ts`, `packages/client/ui-*`).
2. Re-apply the small Tako deltas listed as `TAKE-UPSTREAM` after confirming rc.3 carries them.
3. `pnpm install --lockfile-only`, then `pnpm run build:artifacts`, `pnpm run build:check`.
4. Run focused tests, then `package:mac:arm64:unsigned`, then GUI and signature acceptance.
