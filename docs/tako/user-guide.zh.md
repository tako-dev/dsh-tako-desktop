# DSH Tako 用户指南

[English](user-guide.md) | 中文

DSH Tako 是基于 DeepSeek Harness（MIT 许可）构建的非官方桌面 Agent 应用，内置 Tako 模型和 Tako 工具。它与 DeepSeek 无隶属关系，不是 DeepSeek 官方产品。本指南面向使用者，说明安装、登录、功能、卸载和排错；维护者请看[维护者指南](maintainers.zh.md)。

![DSH Tako 欢迎页](images/01-welcome.png)

![DSH Tako 工作台](images/02-workspace.png)

## 下载与安装

安装包发布在 [GitHub Releases](https://github.com/tako-dev/dsh-tako-desktop/releases)。每个版本包含以下文件：

| 系统 | 下载这个文件 | 说明 |
|---|---|---|
| macOS（Apple Silicon，M 系列芯片） | `DSH-Tako-<版本>-mac-arm64.dmg` | 已签名并公证；若只有 `-unsigned.dmg`，见下文“未签名的 macOS 版本” |
| Windows 10/11（x64） | `DSH-Tako-<版本>-win-x64.exe` | 未做代码签名 |

`latest.yml`、`latest-mac.yml`、`.zip` 和 `.blockmap` 文件供应用内自动更新使用，不需要手动下载。`SHA256SUMS.txt` 列出每个文件的 SHA-256，可用 `shasum -a 256 <文件>`（macOS）或 `Get-FileHash <文件>`（Windows）核对。目前不提供 Intel Mac 和 Linux 安装包。

**macOS**：双击 dmg，把 DSH Tako 拖到“应用程序”文件夹，再从“应用程序”或启动台打开。不要直接在 dmg 窗口里运行。

**Windows**：双击 exe 安装。安装包未签名，Windows SmartScreen 可能提示“Windows 已保护你的电脑”：点“更多信息”，再点“仍要运行”。安装程序按当前用户安装到 `%LOCALAPPDATA%\Programs\DSH Tako`，不需要管理员权限。

**未签名的 macOS 版本**：如果某个版本只提供 `DSH-Tako-<版本>-mac-arm64-unsigned.dmg`，首次打开时 macOS 会拦截。先打开一次，然后到“系统设置 → 隐私与安全性”，在页面底部点“仍要打开”。未签名版本不会自动更新，需要手动下载新版本覆盖安装。

## 首次登录

首次启动显示欢迎页，有两种方式连接 Tako：

1. **通过浏览器登录 Tako**：应用打开系统默认浏览器进入 Tako 授权页。在浏览器里登录并确认授权后，浏览器把授权结果交回本机的 DSH Tako，应用自动保存 API Key 并进入工作台。授权必须在 10 分钟内完成，否则提示超时，可以重试。
2. **粘贴 Tako API Key**：在 Tako 官网获取 API Key，点“粘贴 Tako API Key”，粘贴后点“保存并继续”。应用会先向 Tako 校验这个 Key，校验通过才保存。

API Key 保存在 DSH 凭据存储中，不写入设置文件或聊天记录。之后可以在“设置 → 模型”中替换 Key。

Arc 等浏览器可能把授权页放在一个小弹窗（例如 Arc 的 Little Arc）里打开，而不是普通标签页。请在这个小窗口里完成登录和授权；如果没注意到弹窗，切换到浏览器查找它。完成后回到 DSH Tako 即可。

## 功能

### Tako 模型

DSH Tako 默认使用 `tako` 模型提供方。可用模型由 Tako 服务端管理：应用启动时读取模型目录，读取失败时沿用上次成功的目录。在输入框右下角的模型菜单中选择模型（未选择时显示“请选择模型”）。原有的 DeepSeek 等提供方仍然可以在“设置 → 模型”中配置。

### 五个 Tako 工具

Agent 会根据任务自动调用这些工具，你不需要手动选择。除额度查询外，每次调用都按 Tako 账户计费。

| 工具 | 作用 | 主要参数 |
|---|---|---|
| `tako_search` 搜索 | 联网搜索，返回摘要和来源链接，回答中会引用来源 | `query` 查询词；`count` 来源数量（1–20） |
| `tako_image` 生图 | 根据描述生成图片，结果显示在对话中 | `prompt` 描述；`model` 默认 `gpt-image-2`；`size` 例如 `1024x1024`；`n` 数量 |
| `tako_transcribe` 语音识别 | 把音频转写为文字 | `audioBase64` 音频；`filename`、`mimeType`、`model`、`language` 可选 |
| `tako_speech` 语音合成 | 把文字合成为语音，可在对话中播放 | `text` 文本；`model`、`voice`、`format`（默认 `mp3`）可选 |
| `tako_usage` 额度查询 | 只读查询当前 API Key 的额度，不产生计费请求 | 无 |

例如输入“搜索本周末北京天气，生成一张出行清单图片，再生成一段语音提醒”，Agent 会依次调用搜索、生图和语音合成，结果都保留在同一个对话中。

### 账户与额度

侧边栏底部的 Tako 卡片显示当前额度状态；“设置 → 账户”显示套餐、余额和按日/周/月的用量。充值、续费和套餐变更在 Tako 官网完成。额度读取失败时显示“额度暂不可用”，不会把失败当成余额为零。

### 其他

插件市场、自动化任务、工作区、内置浏览器和终端命令 `dsh-tako` 沿用 DeepSeek Harness 的桌面功能。内置浏览器的标签可以显式“共享给 Agent”，共享期间 Agent 操作的是这个标签的页面和登录状态；停止共享或关闭标签即撤销。

## 与 npm 插件 dsh-tako 的区别

npm 插件 `dsh-tako` 是装在**官方** DSH 里的轻量插件，只为官方 DSH 加上 Tako 模型。DSH Tako 是**完整的桌面应用**，除 Tako 模型外还包含浏览器登录、五个 Tako 工具、额度卡片、Tako 品牌界面和独立的自动更新。两者可以同时使用；如果只想在官方 DSH 里用 Tako 模型，装插件即可。

注意名称：DSH Tako 安装的终端命令也叫 `dsh-tako`，它启动的是 DSH Tako 自带的运行时，与 npm 插件包同名但不是同一个东西。

## 与官方 DSH 并存

DSH Tako 与官方 DSH 桌面版可以同时安装、同时运行，互不影响：

| 项目 | DSH Tako | 官方 DSH |
|---|---|---|
| 应用 ID | `tech.shiroha.dsh-tako` | `com.deepseek.harness` |
| 数据目录（设置、会话、凭据） | `~/.dsh-tako` | `~/.dsh` |
| 终端命令 | `dsh-tako` | `dsh` |
| URL scheme | `dsh-tako://` | `dsh://` |
| 自动更新来源 | 本仓库的 GitHub Releases | 官方更新服务 |

设置了 `DSH_HOME` 环境变量时，DSH Tako 使用该目录，而不是 `~/.dsh-tako`。

## 卸载

**macOS**

1. 退出 DSH Tako，把“应用程序”中的 DSH Tako 拖到废纸篓。
2. 如果安装过终端命令，删除 `/usr/local/bin/dsh-tako`（需要管理员密码：`sudo rm /usr/local/bin/dsh-tako`）。
3. 如需删除全部数据，再删除：`~/.dsh-tako`（会话、设置和 API Key）、`~/Library/Application Support/DSH Tako`、`~/Library/Caches/dsh-tako-desktop-updater`、`~/Library/Logs/DSH Tako`。

**Windows**

1. 退出 DSH Tako（包括系统托盘中的图标），在“设置 → 应用 → 已安装的应用”中卸载 DSH Tako。
2. 如需删除全部数据，再删除：`%USERPROFILE%\.dsh-tako`（会话、设置和 API Key）、`%APPDATA%\DSH Tako`、`%LOCALAPPDATA%\dsh-tako-desktop-updater`。

删除数据目录不会影响官方 DSH 的 `~/.dsh`。

## 常见问题与排错

**浏览器登录后没有跳回应用。** 授权结果通过本机回环地址交回应用，浏览器页面显示完成后，手动切回 DSH Tako 即可。如果应用仍在等待：检查授权页是否在小弹窗或其他浏览器窗口中尚未完成；代理或安全软件可能拦截了本机回环请求；10 分钟后会超时。任何时候都可以改用“粘贴 Tako API Key”。

**提示 Key 无效或已过期。** 确认复制的是完整的 Tako API Key（无多余空格），并在 Tako 官网确认它未被删除或停用。提示“暂时无法连接 Tako”则是网络问题，不是 Key 无效，检查网络或代理后重试。

**侧边栏显示“额度暂不可用”。** 应用读取额度失败，但 Key 本身通常仍可用。稍后重启应用或在“设置 → 账户”刷新；持续失败时到 Tako 官网查看账户状态。额度用完后在官网充值，回到应用刷新即可，刷新不会重复执行已计费的请求。

**更新失败。** 自动更新从 GitHub Releases 下载，访问 GitHub 受限的网络会失败，可以手动从 Releases 下载新版本覆盖安装，数据会保留。未签名的 macOS 版本不支持自动更新。Windows 更新安装包同样未签名，SmartScreen 若再次提示，按“更多信息 → 仍要运行”处理。

**找不到模型或显示“请选择模型”。** 打开输入框右下角的模型菜单选择一个 Tako 模型。菜单为空时，说明模型目录尚未读取成功：确认已连接 Tako（Key 有效），检查网络后重启应用；仍为空时在“设置 → 模型”中检查 Tako 提供方。

**macOS 提示“无法打开，因为无法验证开发者”。** 你下载的是未签名版本，按“未签名的 macOS 版本”一节在“隐私与安全性”中允许打开。
