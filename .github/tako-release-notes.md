DSH Tako {{VERSION}} — 非官方桌面应用，基于 DeepSeek Harness 构建 / an unofficial desktop app built on DeepSeek Harness.

## 下载哪个文件 / Which file to download

| 系统 / System | 文件 / File |
|---|---|
| macOS（Apple Silicon） | {{MAC_DOWNLOAD}} |
| Windows（x64） | `DSH-Tako-{{VERSION}}-win-x64.exe` — 未做代码签名 / not code-signed |

`latest*.yml`、`.zip`、`.blockmap` 供应用内自动更新使用，无需手动下载；`SHA256SUMS.txt` 可用于校验下载文件。The `latest*.yml`, `.zip`, and `.blockmap` files feed in-app updates; `SHA256SUMS.txt` verifies downloads.

## 首次打开 / First launch

- **macOS**：打开 dmg，把 DSH Tako 拖到“应用程序”。Open the dmg and drag DSH Tako to Applications.
- **Windows**：运行 exe。SmartScreen 提示“已保护你的电脑”时，点“更多信息 → 仍要运行”。If SmartScreen appears, choose More info → Run anyway.
- 登录：点“通过浏览器登录 Tako”，或粘贴 Tako API Key。Sign in with Tako in the browser, or paste a Tako API key.

完整说明 / Full guide: [用户指南](https://github.com/tako-dev/dsh-tako-desktop/blob/main/docs/tako/user-guide.zh.md) · [User guide](https://github.com/tako-dev/dsh-tako-desktop/blob/main/docs/tako/user-guide.md)

## 与官方 DSH 的关系 / Relationship to the official DSH

DSH Tako 基于 DeepSeek Harness（MIT 许可）构建，与 DeepSeek 无隶属关系，不是 DeepSeek 官方产品。它使用独立的应用 ID、数据目录 `~/.dsh-tako` 和命令 `dsh-tako`，可以与官方 DSH 桌面版同时安装。DSH Tako is built on DeepSeek Harness (MIT) and is not affiliated with or endorsed by DeepSeek. It uses its own app ID, data directory `~/.dsh-tako`, and command `dsh-tako`, so it installs beside the official DSH desktop.
