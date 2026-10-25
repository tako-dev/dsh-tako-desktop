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

English | [中文](README.zh.md)

DeepSeek Harness (`dsh`) is an open-source agent harness developed by [DeepSeek AI](https://deepseek.com).

It is built on an **everything-is-a-plugin** architecture and powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512).

Documentation: [https://deepseek-harness.github.io/deepseek-harness/](https://deepseek-harness.github.io/deepseek-harness/)

## Developer preview

DeepSeek Harness is in _developer preview_ and iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**

Review the [safety notice](SAFETY.md) before running the project.

## Run

### Run from `npm`

Install `Node.js`, then run:

```sh
npx @deepseek-ai/dsh web
```

The command starts the Web UI at `http://127.0.0.1:3080` by default and opens it in the default browser for a local launch. An SSH launch only prints the host URL because the SSH client or editor owns the local forwarded address. Pass `--no-open` to run the server without opening a browser. See [Web UI guide](docs/user/guide/index.md).

### Run from source

To run from a repository checkout:

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm run build` prepares the repository artifacts. `pnpm dsh web` uses those built artifacts without rebuilding.

## Community and support

- Submit feedback or bug reports through [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions).
- Add the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic to your plugin repository for discoverability.
- Join <a href="https://discord.gg/4MrtZUhpxg">DeepSeek Harness Discord community</a>.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md).

`pnpm run dev:web` builds, serves, and rebuilds client bundles on source edits in one terminal, and `make help` lists the matching Make targets for Web and Desktop; the guide's application commands section owns the full table.

For agents, follow [AGENTS.md](AGENTS.md).

## Citation

```bibtex
@misc{deepseek-harness2026,
  title={DeepSeek Harness: Everything is a Plugin},
  author={DeepSeek-AI},
  year={2026},
  publisher={GitHub},
  howpublished={\url{https://github.com/deepseek-ai/deepseek-harness}},
}
```

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
