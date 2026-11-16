---
kind: upgrade-guide
description: "Profile 模板和组合包目录的导出从 @deepseek-ai/dsh-app-boot 移至 @deepseek-ai/dsh-official-bundles。"
---

# 从归属包导入 profile 模板与组合包列表

[English](guide.md) | 中文

## 变更

`@deepseek-ai/dsh-app-boot` 不再导出 `PROFILE_TEMPLATES`、`ProfileTemplate`、`DEFAULT_PROFILE_BUNDLES`、`OPTIONAL_BUNDLES`、`ON_DEMAND_BUNDLES`、`OFFICIAL_ON_DEMAND_CATALOG`、`OfficialBundleCatalogEntry` 或 Tako 专用的 `TAKO_DEFAULT_BUNDLES`。这些导出归属 `@deepseek-ai/dsh-official-bundles`；从 app-boot 导入会导致编译或加载失败。Profile 名称、组合包顺序、可选项选择和离线元信息保持不变。这次归属迁移不升级已安装内核，也不选择发布通道。

## 迁移

1. 在使用这些导出的包中添加 `@deepseek-ai/dsh-official-bundles` 依赖。仓内工作区使用 `workspace:*`；外部消费者使用与其 DSH 安装匹配的版本。
2. 从 `@deepseek-ai/dsh-official-bundles` 导入上述名称。启动、profile 加载和文件操作仍从 `@deepseek-ai/dsh-app-boot` 导入。
3. 重新构建消费者并核对 profile 选择。Tako 消费者保留紧跟 `@deepseek-ai/dsh-web-app` 的内置 `@deepseek-ai/dsh-tako`；修改导入时不要摘掉它或锁定 npm `dsh-tako`。现有 profile 文件和用户模型选择无需修改。
