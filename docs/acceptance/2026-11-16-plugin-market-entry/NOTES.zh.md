# 插件市场入口验收 · 2026-11-16

[English](NOTES.md) | 中文

工单 a9372170（父单 5c8b788e，tako-dev/dsh-tako-desktop#35）。改动：插件页 Tako 优选中前置「自定义插件市场」入口，修复桌面 profile 检测与 MORE 返回路径，默认关闭、不信任任意索引。

## 改了哪

- `packages/client/ui-plugin-manager/src/client/PluginManagerPage.tsx`：`TAKO_CURATED_BUNDLES` 加入 `@deepseek-ai/dsh-experimental-plugin-market-bundle`（Tako 优选首项）；`takoProfile` 检测从 `listed`（卡片过滤后）改为 `state.packages`（桌面 profile 声明 `@deepseek-ai/dsh-tako` 但不安装它，旧检测漏判）；`detailFromMore` 增补 `!curatedNames.has(view.name)`，修复从 Tako 优选进详情返回时误跳 MORE 列表。
- `packages/experimental/plugin-market-bundle/README.md` / `README.zh.md`：入口说明改为「Tako profile → Tako 优选；其他 profile → More」。

## 怎么验

Tako profile 下启动应用 → 打开插件页 → Tako 优选首项看到「自定义插件市场」，默认关闭 → 开启该 bundle → 出现「发现」tab → 进入发现页 → 打开索引源弹窗（含第三方信任警告）→ 添加示例索引 → 列出条目 → 打开条目详情 → 点击安装 → 安装确认弹窗（含权限警告）→ 安装进行中。无用户交互时不拉取任何外部索引。

## 截图

| 文件 | 证明什么 |
|---|---|
| `03-plugins-list.png` | 插件页 Tako 优选分组中「自定义插件市场」为首项 |
| `04-market-enabled.png` | bundle 默认关闭，手动开启后出现在已启用区 |
| `05-discover-empty.png` | 开启后出现「发现」tab，未加索引源前为空 |
| `06-sources-dialog.png` | 索引源管理弹窗，含第三方索引信任警告文案 |
| `07-source-added.png` | 手动添加示例索引源成功 |
| `08-discover-listing.png` | 发现页列出示例索引中的插件条目 |
| `09-entry-detail.png` | 条目详情页（名称、描述、来源） |
| `10-install-confirm.png` | 安装确认弹窗，含权限/信任警告 |
| `11-install-running.png` | 安装进行中状态 |

## 验的时刻

`2026-11-16 12:47–12:48 CST`（截图实际生成时间，macOS 桌面）。

## 没验 / 验不了

- 改前截图未单独采集：base `v0.1.49` 的 `TAKO_CURATED_BUNDLES` 不含 market bundle，改前该卡只可能从 More 进入，此差异由 diff 与新增测试覆盖。
- 移动端 / Windows 未验（仅 macOS 桌面真实 UI）。
- 安装完成态未验：截图停在「安装检查中」，未等到安装成功/失败终态。
