---
description: "无需启动应用，即可读取安装所持有的 profile 模板、可选组合包选择、离线元信息和受保护插件名称。"
kind: "package-library"
---

# @deepseek-ai/dsh-official-bundles

[English](README.md) | 中文

## 概述

使用本包选择随附 profile、查看安装提供的可选与按需组合包，或识别受保护插件包，无需加载提供方。App boot、CLI（命令行界面）、Desktop、插件管理器和浏览器镜像打包器消费同一组选择。Tako 模板保留内置提供方和配套组合包。这些导出只提供数据；加载、安装和拒绝行为由消费方负责。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

从本包根入口导入 profile 和组合包选择。从 [app-boot](../../boot/app-boot/README.zh.md) 导入 profile 加载与文件操作，从 [plugin-manager](../../boot/plugin-manager/README.zh.md) 导入包操作。本库是依赖，不是 profile 配置层。

`PROFILE_TEMPLATES.tako` 将 `@deepseek-ai/dsh-tako` 放在 `@deepseek-ai/dsh-web-app` 之后，随后是 `TAKO_DEFAULT_BUNDLES`。其他模板保留 base 加模式的组合包栈；`sdk-minimal` 保持独立。`OPTIONAL_BUNDLES` 记录现有安装提供的选择，包括 Tako 配套组合包，但不会在其他 profile 中选中它们。插件市场组合包不属于 Tako 默认选择。

`PROTECTED_PLUGINS` 包括管理依赖，以及 `@deepseek-ai/dsh-tako` 和 `dsh-tako` 两个名称。插件管理器拒绝关闭其配置项和包含它们的组合包，并在调用 pnpm 前拒绝移除。修改此列表不授权安装其他提供方或修改凭据。

`OFFICIAL_ON_DEMAND_CATALOG` 包含各包持有的中英文元信息和图标，不导入提供方，也不锁定安装目标。源资源变化后运行 `pnpm gen-official-bundle-catalog`；`pnpm verify-official-bundle-catalog` 检查新鲜度。插件管理器根据当前运行的 DSH 安装确定安装目标。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

仓库检查以 TypeScript 字面量读取 [`src/bundles.ts`](src/bundles.ts) 中的 profile 与可选项选择。这些声明必须无需执行代码即可检查。`TAKO_DEFAULT_BUNDLES` 从 Tako 模板派生，使配套组合包顺序只有一个归属。[`src/plugin-manager.ts`](src/plugin-manager.ts) 持有受保护包名；[`src/catalog.generated.ts`](src/catalog.generated.ts) 从按需包的资源生成。

Profile 加载器应用精确匹配的安装自有元组迁移和已退役列表。列表本身不写 profile、不修改模型设置，也不改变发布通道。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [App boot profile](../../boot/app-boot/README.zh.md#profiles)——profile 加载与组合。
- [插件管理器](../../boot/plugin-manager/README.zh.md)——启用与安装操作。
- [Tako 维护指南](../../../docs/tako/maintainers.zh.md)——内置提供方不变量。

<a id="model-experience"></a>
## 模型体验

### Profile 组合

#### 模型看到什么

本库不添加模型输入；通过 `PROFILE_TEMPLATES` 选中的插件持有其工具和提示词。

#### Token 影响

读取导出数据不消耗模型 token。

#### KV Cache 影响

本库不发起提供方请求；选中的插件持有面向模型声明的变更。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 选择编译在安装中；profile 文件不能扩展可选或按需目录。
- 消费方执行受保护名称规则并加载选中的包；导入列表不会执行这两类操作。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
