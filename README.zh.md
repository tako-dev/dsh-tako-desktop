# DSH Tako

[English](README.md) | 中文

> 非官方桌面发行版：DSH Tako 基于 DeepSeek Harness（MIT 许可）构建，与 DeepSeek 无隶属关系，不是 DeepSeek 官方产品。原 DeepSeek Harness 的 LICENSE 和版权声明保持不变，官方 README 见下文 [DeepSeek Harness](#deepseek-harness)。

DSH Tako 是内置 Tako 模型和五个 Tako 工具（搜索、生图、语音识别、语音合成、额度查询）的桌面 Agent 应用，支持浏览器登录 Tako、显示 Tako 额度，并可与官方 DSH 桌面版同时安装。

> **Issue 由机器人处理。** 它用维护者账号回复，评论带 `bot` 标记。收到后会说「收到，会改。」，能修的会改、合并、发版，状态写在这条 issue 上。不要贴 API key。[开一个 issue](https://github.com/tako-dev/dsh-tako-desktop/issues/new/choose)。

![DSH Tako 欢迎页](docs/tako/images/01-welcome.png)

![DSH Tako 工作台](docs/tako/images/02-workspace.png)

![侧栏额度：5h / 周剩余进度条 + 钱包余额](docs/tako/images/03-quota-footer.svg)

完整说明见 [DSH Tako 用户指南](docs/tako/user-guide.zh.md)；发版和跟进官方版本见[维护者指南](docs/tako/maintainers.zh.md)。

## 下载与安装

从 [GitHub Releases](https://github.com/tako-dev/dsh-tako-desktop/releases) 下载：

- **macOS（Apple Silicon）**：下载 `DSH-Tako-<版本>-mac-arm64.dmg`，打开后把 DSH Tako 拖到“应用程序”，再从“应用程序”启动。
- **Windows（x64）**：下载并运行 `DSH-Tako-<版本>-win-x64.exe`。安装包未做代码签名，SmartScreen 提示时点“更多信息 → 仍要运行”。

`latest*.yml`、`.zip`、`.blockmap` 供应用内自动更新使用，不需要手动下载。

## 首次登录

欢迎页提供两种方式：点“通过浏览器登录 Tako”，在浏览器中登录并授权后应用自动保存 API Key；或点“粘贴 Tako API Key”，粘贴在 Tako 官网获取的 Key。Arc 等浏览器可能在小弹窗（如 Little Arc）里打开授权页，请在弹窗中完成授权后回到应用。

从未选过模型时，新对话默认 **Tako 的 `deepseek-v4.1-flash`**，不是官方 DeepSeek 模型。

侧栏底部章鱼图标显示套餐 **5h** 和 **本周** 剩余进度条，以及钱包余额。设置 → 通用，版本号旁有「检查更新」。菜单栏「检查更新…」仍可用。

## 与 npm 插件 dsh-tako 的区别

npm 插件 `dsh-tako` 只为**官方** DSH 加上 Tako 模型。DSH Tako 是**完整桌面应用**，另外包含浏览器登录、Tako 工具、额度卡片、Tako 品牌界面和独立的自动更新。DSH Tako 安装的终端命令也叫 `dsh-tako`，与 npm 插件同名但不是同一个东西。

## 与官方 DSH 并存

DSH Tako 使用独立的应用 ID `tech.shiroha.dsh-tako`、数据目录 `~/.dsh-tako`、终端命令 `dsh-tako` 和 URL scheme `dsh-tako://`，自动更新只从本仓库的 GitHub Releases 获取；官方 DSH 使用 `~/.dsh` 和 `dsh`，两者互不影响。

## 卸载

- **macOS**：把“应用程序”中的 DSH Tako 移到废纸篓；装过终端命令时删除 `/usr/local/bin/dsh-tako`。如需清除数据，删除 `~/.dsh-tako`、`~/Library/Application Support/DSH Tako`、`~/Library/Caches/dsh-tako-desktop-updater` 和 `~/Library/Logs/DSH Tako`。
- **Windows**：在“设置 → 应用 → 已安装的应用”中卸载 DSH Tako。如需清除数据，删除 `%USERPROFILE%\.dsh-tako`、`%APPDATA%\DSH Tako` 和 `%LOCALAPPDATA%\dsh-tako-desktop-updater`。

## 常见问题

- **浏览器登录后没有跳回**：浏览器显示完成后手动切回应用；检查授权页是否还在小弹窗里未完成，代理或安全软件可能拦截本机回环请求；10 分钟后超时，可改用粘贴 API Key。
- **Key 无效**：确认复制了完整 Key 且未在官网停用；“暂时无法连接 Tako”是网络问题，不是 Key 无效。
- **额度和官网对不上**：5h / 周进度条是**套餐窗口**（和官网套餐页同一套）。钱包剩余是另一列数字，不要拿钱包去对套餐。
- **更新失败**：自动更新需要访问 GitHub（还没有大陆 CDN）。可从 Releases 覆盖安装，数据会保留；未签名的 macOS 包不支持自动更新。也可在「设置 → 通用」点检查更新。
- **找不到模型**：在输入框右下角选 Tako 模型。新安装且从未选过时默认 Tako `deepseek-v4.1-flash`。

更多问题见[用户指南的排错部分](docs/tako/user-guide.zh.md)。

# DeepSeek Harness

DeepSeek Harness（`dsh`）是由 [DeepSeek AI](https://deepseek.com) 开发的开源 agent harness（智能体框架）。

它构建于**一切皆插件**的架构之上，由 [Cordis](https://github.com/cordiverse/cordis) 驱动，其设计参见论文 [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512)。

文档：[https://deepseek-harness.github.io/deepseek-harness/](https://deepseek-harness.github.io/deepseek-harness/)

## 开发者预览

DeepSeek Harness 处于 _开发者预览_ 阶段，正在快速迭代。**未来将出现破坏兼容性的变更。**

运行本项目前，请阅读[安全说明](SAFETY.zh.md)。

<a id="run"></a>

## 运行

### 通过 `npm` 运行

安装 `Node.js`，然后运行：

```sh
npx @deepseek-ai/dsh web
```

该命令默认会在 `http://127.0.0.1:3080` 启动 Web UI，本机启动时还会用默认浏览器打开页面。通过 SSH 启动时只打印宿主机 URL，因为本地转发地址由 SSH 客户端或编辑器持有。传入 `--no-open` 可仅运行服务器而不打开浏览器。详见 [Web UI 指南](docs/user/guide/index.zh.md)。

<a id="run-from-source"></a>

### 从源码运行

如需从仓库源码运行：

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm run build` 会准备仓库产物。`pnpm dsh web` 会直接使用这些已构建产物，不会重新构建。

## 社区与支持

- 通过 [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions) 提交反馈或 bug 报告。
- 为你的插件仓库添加 [`dsh-plugin`](https://github.com/topics/dsh-plugin) 话题，便于被发现。
- 欢迎加入 DeepSeek Harness 企微群！扫描下方二维码填写入群问卷，小助手会定期发送入群邀请。

<table>
  <thead>
    <tr>
      <th align="center">入群问卷</th>
      <th align="center">微信公众号</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td align="center"><a href="https://trtgsjkv6r.feishu.cn/share/base/form/shrcnIt5twSVdLGD52KJBckGCgg"><img src="https://cdn.deepseek.com/harness/readme/community-wecom-survey.png" alt="DeepSeek Harness 入群问卷二维码" width="180" height="180"></a></td>
      <td align="center"><img src="https://cdn.deepseek.com/harness/readme/community-wechat-official-account.png" alt="DeepSeek Harness 团队微信公众号二维码" width="180" height="180"></td>
    </tr>
  </tbody>
</table>

## 参与贡献

参见 [CONTRIBUTING.md](CONTRIBUTING.zh.md)。

## 开发

请先阅读[开发指南](docs/development.zh.md)与[架构文档](docs/architecture.zh.md)。

`pnpm run dev:web` 会在一个终端里完成构建、启动，并在源码修改时重建 client bundle；`make help` 列出 Web 与 Desktop 对应的 Make target。完整表格见开发指南的「应用命令」一节。

面向 agent：请遵循 [AGENTS.md](AGENTS.md)。

## 引用

```bibtex
@misc{deepseek-harness2026,
  title={DeepSeek Harness: Everything is a Plugin},
  author={DeepSeek-AI},
  year={2026},
  publisher={GitHub},
  howpublished={\url{https://github.com/deepseek-ai/deepseek-harness}},
}
```

## 许可证

[MIT](LICENSE)

第三方依赖及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
