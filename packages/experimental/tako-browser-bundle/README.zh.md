---
description: "预装 Tako Agent 浏览器工具，并使用隔离的 Chromium profile。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-tako-browser-bundle

[English](README.md) | 中文

## 概述

Tako profile 会预装 Agent 浏览器工具。每个 Agent 默认使用独立且持久化的 Chromium profile。在 Desktop 中，用户可以在 Browser 标签选择**共享给 Agent**；`desktop_browser` 随后操作同一个实时标签与登录态。**停止共享**或关闭标签会撤销访问，同时保留浏览器存储。

浏览器层相对于 DSH 核心是可选的。如果 Chromium 启动或下载失败，Tako 的文本、图片、语音和搜索能力仍然可用，浏览器之后可以重试。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

Tako profile 默认启用此组合包，因此每个 Agent 已经拥有浏览器工具，并使用与其他 Agent 隔离的独立持久化 Chromium profile。在 Desktop 中，打开 Browser 标签并选择**共享给 Agent**，`desktop_browser` 即可操作实时标签及其登录态；**停止共享**或关闭标签会撤销该访问，同时保留浏览器存储。禁用此组合包会移除 Agent 浏览器工具，已存储的 profile 保持不变。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>维护者信息 — 点击展开</summary>

静态 `cordis.patch.yml` 插入两行：`tako-agent-browser-use` 挂载 [`dsh-browser-use`](../../browser-use/browser-use/README.zh.md)，`tako-agent-browser` 以 `launch` 模式、`headless: true` 挂载实验性 Playwright MCP 浏览器 provider。Tako profile 模板通过 `TAKO_DEFAULT_BUNDLES`（[`dsh-official-bundles`](../../util/official-bundles/README.zh.md)）携带此组合包，因此插件管理器将已安装副本视为安装内置。

</details>

-----

<a id="model-experience"></a>
## 模型体验

该包通过挂载的浏览器 provider 间接影响模型：Tako profile 中的 Agent 获得 Playwright MCP 浏览器工具与截图，其说明见 [`dsh-experimental-browser-use-playwright-mcp`](../browser-use-playwright-mcp/README.zh.md#model-experience)。

#### KV Cache 影响

启用或禁用此组合包会在 Tako Agent 会话中增加或移除浏览器工具 schema，从而改变后续请求的缓存请求前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- Agent 浏览器始终以 headless Chromium 启动，并为每个 Agent 维持一个持久化 profile；Desktop 的**共享给 Agent** 是 Agent 操作用户实时标签与登录态的唯一途径。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者信息 — 点击展开</summary>

无。

</details>
