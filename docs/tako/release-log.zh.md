# DSH Tako 发版日志

[English](release-log.md) | 中文

[GitHub Releases 页面](https://github.com/tako-dev/dsh-tako-desktop/releases) 是已发布版本、安装包和校验和的权威来源。每个新版本包含本次合并 PR 摘要、与上次发布的比较、实际构建源码和内置 DSH 版本。客户端直接选择最新兼容稳定版，无需逐个安装中间版本。

## v0.1.45 — 2026-10-31

- 原生恢复弹窗增加“复制诊断报告路径”，复制完整路径后保持恢复界面，剪贴板失败可重试。
- 来源：[PR #31](https://github.com/tako-dev/dsh-tako-desktop/pull/31)、[issue #29](https://github.com/tako-dev/dsh-tako-desktop/issues/29)。内置 DSH：0.2.1-rc.5。
- [发布与安装包](https://github.com/tako-dev/dsh-tako-desktop/releases/tag/v0.1.45) · [相对 v0.1.44 的变更](https://github.com/tako-dev/dsh-tako-desktop/compare/v0.1.44...v0.1.45)。

## v0.1.44 — 2026-10-30

- 声明账户页面的 credentials 依赖以恢复启动；调整权限的轮次状态读取，不禁用 lint 检查。
- 来源：[PR #30](https://github.com/tako-dev/dsh-tako-desktop/pull/30)、[issue #29](https://github.com/tako-dev/dsh-tako-desktop/issues/29)。内置 DSH：0.2.1-rc.5。
- [发布与安装包](https://github.com/tako-dev/dsh-tako-desktop/releases/tag/v0.1.44)。

## v0.1.41 — 2026-10-30

- 工作台插件登录后，桌面侧栏使用更新的 API key 刷新额度。插件 0.5.14 使用本机凭据，key 变化时刷新侧栏。
- 来源：[issue #19](https://github.com/tako-dev/dsh-tako-desktop/issues/19) · [发布](https://github.com/tako-dev/dsh-tako-desktop/releases/tag/v0.1.41)。

## v0.1.39 — 2026-10-30

- 新会话沿用上一次选择的权限，包括完全权限。自动审查仍只作用于当前会话。
- 内置 DSH：0.2.1-rc.2 → 0.2.1-rc.5。v0.1.38 打包时 Tako 包版本未对齐，安装包构建失败，其 tag 未移动；v0.1.39 已发布。
- 来源：[issue #15](https://github.com/tako-dev/dsh-tako-desktop/issues/15) · [发布](https://github.com/tako-dev/dsh-tako-desktop/releases/tag/v0.1.39)。
