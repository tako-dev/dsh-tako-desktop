# Windows 电脑使用（只读观察）

[English](README.md) | 中文

一个可选的 DSH 插件包，通过固定版本的 [`dsh-computer-use-win`](https://www.npmjs.com/package/dsh-computer-use-win) MCP 服务器（PowerShell UI 自动化后端）为智能体提供对 Windows 桌面的**只读**访问，由 `@deepseek-ai/dsh-mcp-client` 桥接。

## 智能体能做什么

只启用观察类工具：UIA 可访问性树、屏幕快照与截图、OCR、窗口列表、元素查找与等待。工具以真实注册名 `mcp__wincu__windows_computer_use_<工具名>` 呈现。

## 拒绝什么

上游提供的所有输入、修改与管理类工具——点击、输入、拖拽、滚动、按键、调用、设置值、窗口激活/关闭/移动、启动应用、批量执行与工具管理——都被双重拒绝：在 `enabledTools` 中写这些名字会在任何进程启动前使配置校验失败；以真实注册名 `mcp__wincu__windows_computer_use_<工具名>` 仍进入管线的调用会被调度前守卫与 `tools/pre-execute` 按注册名拒绝，绝不联系上游服务器。拒绝不依赖终止或取消，因此不会截断上游的 `finally`（拖拽释放、对话框还原）。

## 发布

仅限 Windows（`os`、`dsh.bundle.platforms`）。发布与 CI 的 Windows 安装包携带本插件包：`package:desktop:win:x64:unsigned-release --computer-use-win` 会设置 `DSH_DESKTOP_COMPUTER_USE_WIN`，使 `prepare-package-set.ts` 将其 tarball 加入打包集合，运行时 lockfile 按固定的上游完整性哈希校验。本地打包仍须 `--computer-use-win` 显式启用才会带入。带上后，在插件管理器中按配置文件启用，与其他可选插件包一致。
