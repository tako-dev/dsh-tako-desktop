# DSH Tako 维护者指南

[English](maintainers.md) | 中文

本指南面向维护 [tako-dev/dsh-tako-desktop](https://github.com/tako-dev/dsh-tako-desktop) 的人：开发环境、本地打包、发版、签名 secrets、跟进官方 DeepSeek Harness 新版本，以及 DSH Tako 与官方版本的隔离点。使用说明见[用户指南](user-guide.zh.md)。

## 开发环境

- Node.js 24（`package.json` 的 `engines` 允许 `^22.19.0 || >=24.0.0`，打包和 CI 使用 24）。
- pnpm 使用根 `package.json` 的 `packageManager` 版本（`pnpm@11.28.5`），可由 Corepack 或 `pnpm/action-setup` 自动选择。
- macOS 打包需要 Xcode 命令行工具；Windows 打包需要 Visual Studio C++ Build Tools、Windows SDK、Python 和 PowerShell（GitHub 的 `windows-latest` 已具备）。

```sh
pnpm install
pnpm run dev:desktop      # build, then launch the desktop app in development mode
pnpm run typecheck
pnpm run lint
```

CI（[ci.yml](../../.github/workflows/ci.yml)）在推送到 `main` 和 PR 时运行 typecheck、lint 和以下 vitest 子集：`apps/desktop`（含 `apps/desktop-host`）、`packages/tako`、`ui-brand-official`、`ui-settings-account`、`ui-conversation`、`ui-layout`、`app-boot`，以及本 fork 新增的脚本测试。全量测试由官方仓库负责；改动其他包时在本地补跑相关测试。

## 本地打包

| 命令 | 产物 | 说明 |
|---|---|---|
| `pnpm --filter @deepseek-ai/dsh-desktop run package:mac:arm64:unsigned` | `apps/desktop/.desktop-build/targets/mac-arm64/unsigned-artifacts/DSH-Tako-<版本>-mac-arm64-unsigned.dmg` | 不读取 `.env.macos`，ad-hoc 签名，无自动更新 |
| `pnpm run package:desktop:mac:arm64` | `…/mac-arm64/artifacts/` 下 dmg、zip、zip.blockmap、`latest-mac.yml` | 签名并公证，需要 `apps/desktop/.env.macos`（模板 `.env.macos.example`） |
| `pnpm run package:desktop:win:x64:unsigned-release`（Windows 主机） | `…/win-x64/unsigned-artifacts/` 下 `DSH-Tako-<版本>-win-x64.exe`、`.exe.blockmap`、`latest.yml` | 无代码签名，但写入 GitHub 更新源；需要存在 `apps/desktop/.env.windows`（可为空） |

任一命令加 `--check` 只校验配置和工具链。打包日志在 `apps/desktop/.desktop-build/packaging-runs/`。细节见[打包说明](../../apps/desktop/packaging/README.zh.md)。

## 版本

应用版本的唯一来源是 [tako-desktop-identity.mjs](../../apps/desktop/scripts/tako-desktop-identity.mjs) 中的 `TAKO_DESKTOP_VERSION`。打包时它写入安装包文件名、`latest*.yml` 和应用的 `app.getVersion()`。`apps/desktop/package.json` 与根 `package.json` 的 `version` 是内置 DSH 运行时版本（例如 `0.2.1-rc.2`），跟随官方，不要改成 Tako 版本，打包会校验两者一致。`DSH_TAKO_DESKTOP_VERSION` 环境变量只用于本地试验，发版工作流不设置它。

发版只接受稳定版本 `MAJOR.MINOR.PATCH`：更新通道是 `latest`，electron-builder 拒绝在该通道发布预发布版本。

## 发版流程

1. 修改 `TAKO_DESKTOP_VERSION`（例如 `0.1.1`），提 PR，等 CI 通过后合并到 `main`。
2. 在合并后的提交上打 tag 并推送：`git tag v0.1.1 && git push tako v0.1.1`（`tako` 为指向本仓库的 remote）。
3. [release.yml](../../.github/workflows/release.yml) 自动运行：
   - `plan`：要求 tag 等于 `v` + `TAKO_DESKTOP_VERSION`，否则立即失败。
   - `macos`（`macos-15`，arm64）：六个 Apple secrets 齐全时导入证书、签名并公证；缺少任一 secret 时失败并列出缺失项。
   - `windows`（`windows-latest`）：构建未签名的 NSIS 安装包，写入 GitHub 更新源。
   - `publish`：两个平台都成功后，生成 `SHA256SUMS.txt` 和发布说明（模板 [.github/tako-release-notes.md](../../.github/tako-release-notes.md)），用 `gh release create <tag> --verify-tag` 创建 Release；Release 已存在时改用 `gh release upload --clobber` 替换附件，不改动已有说明。只有这个 job 拥有 `contents: write`。
4. 检查 Release 附件：`DSH-Tako-<版本>-mac-arm64.dmg`、`.zip`、`.zip.blockmap`、`latest-mac.yml`、`DSH-Tako-<版本>-win-x64.exe`、`.exe.blockmap`、`latest.yml`、`SHA256SUMS.txt`。

发布说明包含 GitHub 生成的本次合并 PR 清单与版本比较链接、实际构建提交、内置 DSH 版本及其构建清单和上游项目。缺少变更详情时停止发布；重跑不改写已有发布说明。稳定版客户端可直接更新到最新兼容稳定版，无需逐版安装；兼容性检查、包校验、下载和安装的独立确认及禁止降级仍然生效。

在 Actions 页面手动运行 Release（`workflow_dispatch`）可以输入已有 tag，并选择：

- `dry_run`：只构建并保留 Actions artifact（`release-mac-arm64`、`release-win-x64`），在运行摘要中显示校验和与发布说明，不创建或修改 Release。
- `allow_unsigned_mac`：缺少 Apple secrets 时仍发布 `DSH-Tako-<版本>-mac-arm64-unsigned.dmg`。该包不含 zip 和 `latest-mac.yml`，没有自动更新；已安装签名版本的 mac 用户手动检查更新时会因缺少 `latest-mac.yml` 看到失败提示。

重跑失败的工作流是幂等的：构建产物相同名称会覆盖已有附件。

## Secrets 清单

在仓库 Settings → Secrets and variables → Actions 中配置。缺少任一项时 macOS job 失败（除非手动运行并勾选 `allow_unsigned_mac`）。

| Secret | 内容 | 用途 |
|---|---|---|
| `APPLE_CERTIFICATE` | Developer ID Application 证书及私钥导出的 `.p12`，再做 base64（`base64 -i cert.p12`） | 解码为临时文件，作为 `CSC_LINK`；官方打包脚本把它导入自己的临时钥匙串签名 |
| `APPLE_CERTIFICATE_PASSWORD` | 导出 `.p12` 时设置的密码 | `CSC_KEY_PASSWORD` |
| `APPLE_ID` | 用于公证的 Apple ID 邮箱 | `APPLE_ID`（notarytool） |
| `APPLE_PASSWORD` | 该 Apple ID 的 App 专用密码（appleid.apple.com 生成），不是登录密码 | `APPLE_APP_SPECIFIC_PASSWORD`（notarytool） |
| `APPLE_TEAM_ID` | 10 位 Apple Developer Team ID，必须与证书一致 | `APPLE_TEAM_ID` 与 `DSH_DESKTOP_MACOS_TEAM_ID` |
| `KEYCHAIN_PASSWORD` | 任意随机字符串 | 创建一次性钥匙串，从证书读出 `Developer ID Application: 名称 (TEAMID)` 身份后立即删除 |

工作流把这些值写入 `apps/desktop/.env.macos`（权限 600，job 结束时删除），官方签名路径从该文件读取：`DSH_DESKTOP_APP_ID=tech.shiroha.dsh-tako`、`DSH_DESKTOP_MACOS_SIGNING_IDENTITY`（去掉 `Developer ID Application: ` 前缀的身份名）、`DSH_DESKTOP_MACOS_TEAM_ID`、`CSC_LINK`、`CSC_KEY_PASSWORD`、`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`。公证使用 notarytool 的 Apple ID + App 专用密码 + Team ID 方式。Windows 不需要 secrets。发布使用工作流自带的 `GITHUB_TOKEN`。

## 自动更新

应用通过 electron-updater 读取 GitHub Releases（`provider: github`、`owner: tako-dev`、`repo: dsh-tako-desktop`、通道 `latest`）。这一配置写入安装包内的 `app-update.yml`：macOS 由打包脚本写入并校验，Windows 由 electron-builder 写入。应用只在 `app-update.yml` 存在时启用更新。

- macOS 自动更新要求应用已用 Developer ID 签名并公证；Squirrel.Mac 拒绝为未签名应用安装更新，因此未签名 mac 包不写入更新源。
- Windows 安装包未签名，`app-update.yml` 不含 publisher 名称，electron-updater 不校验更新包签名，只校验 `latest.yml` 中的 SHA-512。

强制更新策略（`dshMandatoryUpdatePolicy`）未启用：未设置 `DSH_DESKTOP_MANDATORY_UPDATE_*_ORIGIN` 和 `DSH_DESKTOP_MANDATORY_UPDATE_CONFIG` 时不写入策略，应用不发起策略请求。设置其中任一项会启用官方策略并要求完整配置，见 [desktop-policy-environment.mjs](../../apps/desktop/scripts/desktop-policy-environment.mjs) 和[桌面 README](../../apps/desktop/README.zh.md#mandatory-update-policy)。

## 跟进官方新版本

官方仓库的 remote 为 `origin`，发布 tag 形如 `dsh-v0.2.1-rc.3`。

1. `git fetch origin --tags`，新建分支，`git merge dsh-v<版本>`。冲突时以官方代码为准，再在新 API 上重新应用 Tako 行为。
2. 官方新增或修改的 `.github/` 工作流、`dependabot.yml`、issue 模板会重新出现（修改/删除冲突或新文件）：全部 `git rm`，保留本仓库的 `ci.yml`、`release.yml`、`AGENTS.md`、`tako-release-notes.md`。官方新增的读取工作流文件的 spec 也删除，并把路径加入 [tako-removed-upstream-paths.ts](../../scripts/tako-removed-upstream-paths.ts)。
3. 根 `package.json` 和 `apps/desktop/package.json` 的 `version` 跟随官方；若官方新增 `test:approval-policy` 一类依赖已删目录的脚本或 run-gates 门禁，一并删除。
4. `pnpm install` 更新锁文件，然后运行 `pnpm run typecheck`、`pnpm run lint`、CI 中的 vitest 子集和 `pnpm run test:docs`，最后本地执行一次 `package:mac:arm64:unsigned` 并启动检查欢迎页、登录和品牌。
5. 合并后的提交消息写明官方版本，例如 `merge: follow official DSH 0.2.1-rc.3`。

冲突热点文件：

- 打包：`apps/desktop/scripts/electron-builder-config.mjs`、`package-target.ts`、`package-macos.ts`、`desktop-package-environment.mjs`、`desktop-release-environment.mjs`、`desktop-policy-environment.mjs`、`desktop-build-paths.mjs`、`macos-app-update-config.mjs`、`smoke-packaged-runtime.ts`、`prepare-cli.ts`、`.env.*.example`。
- 桌面主进程：`apps/desktop/src/main.ts`、`locale.ts`、`welcome-*.ts`、`update-coordinator.ts`、`command-installation.ts`、`command-management.ts`、`host-process.ts`、`browser-guests.ts`，以及 `apps/desktop/tests/expected/` 下的期望输出。
- 安装器与资源：`apps/desktop/installer/`、`apps/desktop/cli/`、`apps/desktop/resources/` 图标、`apps/desktop/renderer/`。
- 客户端与启动：`packages/client/ui-brand-official`、`ui-settings-account`、`ui-settings-models`、`ui-sidebar-browser`、`ui-conversation`、`ui-layout`、`ui-plugin-manager`，`packages/boot/app-boot/src/profile.ts`、`packages/boot/plugin-manager`。
- 仓库级：根 `README.md`/`README.zh.md` 开头的 DSH Tako 部分、`package.json` scripts、`pnpm-lock.yaml`、`scripts/run-gates.ts`、`scripts/verify-md-links.ts`、`tsconfig.*.json`。

## 品牌与隔离点

| 项目 | 值 | 位置 |
|---|---|---|
| 产品名（应用包名、菜单、Electron userData 目录） | `DSH Tako` | `tako-desktop-identity.mjs`、`src/tako-identity.ts` |
| 应用 ID（拒绝官方 `com.deepseek.harness`） | `tech.shiroha.dsh-tako` | `tako-desktop-identity.mjs`、`desktop-release-environment.mjs` |
| URL scheme | `dsh-tako://` | 同上 |
| 终端命令 | `dsh-tako`（macOS `/usr/local/bin/dsh-tako`，Windows `dsh-tako.cmd`） | `apps/desktop/cli/`、`src/tako-identity.ts`、`command-path.ps1` |
| 数据目录 | `~/.dsh-tako`（`DSH_HOME` 未设置时） | `src/tako-identity.ts` |
| 安装包文件名前缀 | `DSH-Tako` | `tako-desktop-identity.mjs` |
| 打包 `package.json` 名称（更新缓存目录 `dsh-tako-desktop-updater`） | `dsh-tako-desktop` | 同上 |
| 更新源 | GitHub Releases `tako-dev/dsh-tako-desktop` | `TAKO_DESKTOP_GITHUB_PUBLISH` |
| 图标、欢迎页、安装器文案 | Tako 图标与文案 | `apps/desktop/resources/`、`renderer/`、`installer/strings.nsh`、`src/locale.ts` |
| Web 客户端品牌和标题 | DSH Tako | `packages/client/ui-brand-official`、`ui-layout` |

## 不能破的 profile 不变量（2026-10-26）

0.1.5 在 npm 插件还没装上时，就把 `@deepseek-ai/dsh-tako` 从 desktop profile 摘掉，Tako 模型和工具全部消失。下面这些检查必须保持绿：

| 锁 | 位置 |
|---|---|
| 自带 `tako` 模板仍把 `@deepseek-ai/dsh-tako` 放在 `dsh-web-app` 后面 | `apps/desktop/tests/tako-profile-invariants.spec.ts` |
| `createPluginProfile` 保留该 bundle，且**不**把 npm `dsh-tako` 写进 dependencies | 同上 + `scripts/smoke-runtime.ts`（打包烟测） |
| `applyRelease` 会把被摘掉的 bundle 加回去 | `tako-profile-invariants.spec.ts` |
| `applyRelease` / `createPluginProfile` 不摘 bundle、不 pin npm `dsh-tako` | `tako-profile-invariants.spec.ts` |
| 安装 npm `dsh-tako` 走 desktop-host CLI + `ELECTRON_RUN_AS_NODE`，不走 `dsh/lib/bin.js` | `tako-npm-plugin.spec.ts` |
| 欢迎页仍把 settings `ns === 'tako'` 当成 Tako | `tako-profile-invariants.spec.ts`、`welcome-host.spec.ts` |

不要 skip、删除或放宽这些测试。不要在 `applyRelease` / `createPluginProfile` 里摘掉内置 Tako 层，除非 npm 插件已经装上，并且在真实 DSH Tako profile 上做过升级验证。npm `dsh-tako` 已经在磁盘上时，要继续留在 bundle 列表里。官方 DeepSeek 登录藏掉，Desktop preload 会设置 `__DSH_TAKO_PROFILE__`。`apps/desktop/src/tako-npm-plugin.ts` 里还留着 0.1.5 的摘包函数；文件还在不等于可以再接到启动路径上。

## 已知限制

- Windows 安装包未做代码签名：首次安装和更新可能触发 SmartScreen，企业策略可能阻止运行。
- 未签名的 macOS 包（`allow_unsigned_mac`）没有自动更新，用户需要在“隐私与安全性”中手动允许打开。
- 强制更新策略未启用，无法强制用户升级。
- 只发布 macOS arm64 和 Windows x64；不发布 Intel Mac 和 Linux 安装包。
- 只发布稳定版本；预发布版本需要另行设计更新通道。
- 自动更新依赖访问 GitHub；访问受限的网络需要手动下载。
- CI 只运行与 Tako 和桌面相关的测试子集，官方其余测试不在本仓库运行。
