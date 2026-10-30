# DSH Tako 发版日志

机器人在每次发版成功后追加。

## v0.1.39 — 2026-10-30

- 新会话会沿用上一次选的权限（含完全权限）。自动审查仍只作用于当前会话。
- 官方内核 0.2.1-rc.2 → 0.2.1-rc.5。
- v0.1.38 安装包没打出来（Tako 包版本没对齐），那个 tag 没挪。v0.1.39 已发布。
- https://github.com/tako-dev/dsh-tako-desktop/issues/15

## v0.1.41 — 2026-10-30

- 进入工作台后在插件里登录，桌面侧栏额度会重新读取 TAKO_API_KEY。
- 插件 0.5.14：工作台登录走本机凭据，侧栏在 key 变化后刷新。
- https://github.com/tako-dev/dsh-tako-desktop/issues/19
