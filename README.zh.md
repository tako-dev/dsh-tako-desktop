<!-- DSH Tako fork notice: keep this block identical in README.md and README.zh.md. -->
> **DSH Tako** — 非官方桌面发行版 / unofficial desktop distribution
>
> **中文**：本仓库（[tako-dev/dsh-tako-desktop](https://github.com/tako-dev/dsh-tako-desktop)）是基于 DeepSeek Harness（MIT 许可）构建的非官方桌面应用 **DSH Tako**，与 DeepSeek 无隶属关系，也不是 DeepSeek 官方产品。它在官方 DSH 桌面版之上集成了 Tako：Tako 模型提供方（用 Tako API Key，模型目录由 Tako 服务端管理）、五个 Tako Agent 工具（搜索、生图、语音识别、语音合成、只读额度查询）、浏览器登录（PKCE，登录 tako.shiroha.tech 后自动换取 Key）、设置中的 Tako 额度与用量、插件页的 Tako 优选和浏览器共享。DSH Tako 使用独立的应用 ID（`tech.shiroha.dsh-tako`）、数据目录（`~/.dsh-tako`）和 URL scheme（`dsh-tako://`），可以与官方 DSH 桌面版同时安装。
>
> 下载：macOS（Apple Silicon，签名并公证）与 Windows 安装包将发布在 [GitHub Releases](https://github.com/tako-dev/dsh-tako-desktop/releases)（**暂未发布**）。应用内自动更新也只从该 Releases 获取。
>
> 与 npm 插件 `dsh-tako` 的区别：`dsh-tako` 插件是给**官方** DSH 加上 Tako 模型的轻量插件；DSH Tako 是**完整桌面应用**，额外包含浏览器登录、Tako 工具和上面的桌面集成。
>
> **English**: This repository builds **DSH Tako**, an unofficial desktop application built on DeepSeek Harness (MIT). It is not affiliated with or endorsed by DeepSeek. It adds Tako to the official DSH desktop: the Tako model provider, five Tako agent tools (search, image generation, speech-to-text, text-to-speech, read-only quota), browser sign-in, Tako quota and usage in Settings, Tako picks in Plugins, and browser sharing. It uses its own app ID, data directory (`~/.dsh-tako`), and URL scheme, so it can be installed beside the official DSH desktop. Installers for macOS (Apple Silicon, signed and notarized) and Windows will be published on [GitHub Releases](https://github.com/tako-dev/dsh-tako-desktop/releases) (not yet released). The npm plugin `dsh-tako` only adds Tako models to the official DSH; DSH Tako is the complete desktop app.
>
> The original DeepSeek Harness LICENSE and copyright notice are retained unchanged; the upstream README follows.

# DeepSeek Harness

[English](README.md) | 中文

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
