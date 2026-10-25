---
description: "预装 Tako Agent 浏览器工具，并使用隔离的 Chromium profile。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-tako-browser-bundle

[English](README.md) | 中文

## 概要

Tako profile 会预装 Agent 浏览器工具。每个 Agent 默认使用独立且持久化的 Chromium profile。在 Desktop 中，用户可以在 Browser 标签选择**共享给 Agent**；`desktop_browser` 随后操作同一个实时标签与登录态。**停止共享**或关闭标签会撤销访问，同时保留浏览器存储。

浏览器层相对于 DSH 核心是可选的。如果 Chromium 启动或下载失败，Tako 的文本、图片、语音和搜索能力仍然可用，浏览器之后可以重试。
