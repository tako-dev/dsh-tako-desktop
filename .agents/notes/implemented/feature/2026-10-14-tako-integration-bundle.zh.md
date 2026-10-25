# Agent Note: Tako 集成 bundle 与首次提供方配置

Status: implemented

[English](2026-10-14-tako-integration-bundle.md) | 中文

## Problem

Tako 需要以提供方集成进入 DSH，同时继续复用官方 Desktop 宿主，不能另起一套 Desktop。首次启动还必须配置当前 profile 实际安装的提供方；始终打开 DeepSeek 官方配置会让 Tako profile 把用户引向错误的账号。

## Decision

仓库以 profile bundle 和运行时插件的形式提供 `@deepseek-ai/dsh-tako`。`tako` profile 组合 base 与 Web bundle，再挂载 Tako provider、内置 skill 以及五个 Agent tool：搜索、生图、语音识别、语音生成和只读额度查询。文本请求复用 DSH 官方 OpenAI 兼容 adapter；Tako client 每次操作都通过 DSH credentials 解析 `TAKO_API_KEY`，并携带 DSH 关联请求头。

Native Desktop welcome 和 Models 设置客户端都识别 `llm-tako` namespace。首次提供方步骤在存在无路径 Tako 路由时优先选择它，否则选择 DeepSeek 官方路由。Tako 编辑器通过 `credentials.set` 写入 key，允许编辑接口地址，并说明模型目录由服务端管理，不允许浏览器直接替换。

模型目录优先读取 Tako 公开价格目录，再回退到带 key 的模型目录；两个接口都不可用时保留上次成功目录。原有 DSH 提供方继续可用，提供方失败不会自动切换到其他提供方。目标 Desktop 用户路径见 [Tako Desktop 用户流程](../../../../docs/tako-user-flow.zh.md)。

## Package topology

宿主 bundle 位于 `packages/tako/tako`；`packages/boot/app-boot/src/profile.ts` 负责 `tako` 模板，Desktop project manager 也会把同一个 bundle 注入固定的 `desktop` runtime profile。浏览器首次配置仍由 `packages/client/ui-settings-models` 持有，该包已经负责 Models 页面和首次弹窗。这样 provider 实现不依赖浏览器 renderer，而持久化继续由现有 credentials 与 settings 协议负责。

CLI 入口在 `apps/cli/tests/tako-profile.e2e.spec.ts` 中有无 key composition smoke：测试启动 source CLI，dump `tako` 默认层，并断言 Tako bundle 和 `TAKO_API_KEY` 引用存在，不发起付费请求。Desktop 打包还把 `@deepseek-ai/dsh-tako` 作为签名本地 package closure 的根，因此安装后固定的 `desktop` profile 可以加载 bundle。

bundle 还导出 release manifest helper，校验 HTTPS artifact 地址、选择国内/海外 CDN 回退、执行最低 DSH 版本检查，并提供 SHA-256 与 Ed25519 校验。同一 seam 会解析带签名的优选插件目录，只让 required、trusted 且没有额外权限或构建脚本的条目进入无人值守安装。Desktop 现在会按 DSH 版本和已安装 Tako bundle 版本精确拦截不兼容更新；macOS 与 Windows 引导脚本会在调用官方安装器前校验制品。这些 helper 是安装器基础；清单签名以及平台安装包的发布仍属于 release infrastructure。

## Alternatives considered

**Fork 官方 Desktop 应用。** 放弃，因为官方 Desktop 已经拥有 Web surface 和 profile 生命周期。使用 bundle 能让更新和原有提供方继续走原生 DSH 路径。

**把 Tako 当作无类型的自定义提供方。** 放弃，因为该提供方需要稳定模型目录、凭据引用、计费工具、关联元数据和 profile 模板；交给通用自定义提供方表单会丢失这些保证。

**始终显示 DeepSeek 官方首次配置弹窗。** 放弃，因为 Tako profile 会询问错误的 key。首次配置目标从提供方目录推导，只有在组合了无路径 Tako 路由时才让 Tako 优先。

## Consequences

`dsh --profile tako` 首次启动可以配置 Tako key，同时不会把 secret 写进 settings 或聊天记录。API key 配置、接口地址编辑、模型选择、工具调用、按 key 额度读取、脱敏账户额度卡、只读钱包余额和活动套餐投影、日/周/月账本字段、按关联 ID 查询消耗回执、图片附件渲染、挂载通用文件附件服务时的生成音频持久化以及 release artifact 校验都沿用 DSH 扩展点，并且可以在不发起付费请求的情况下测试。release 模块还通过调用方提供的平台适配器执行 download → verify → configure → validate → start 阶段机。Desktop 已经负责一次性 loopback 网页登录回调和官方更新兼容性拦截；已发布的 CDN 清单/签名、动态签名插件市场优选、门户支付流程仍是独立工作，因为它们的上游协议不在当前 DSH/Tako API seam 中。Tako 本地服务把 JWT 门户接口与 API key 网关分开，因此 bundle 不会从 `cr_` key 猜测门户权限，也不会把缺失的聚合误当成零消耗。


Desktop 的 Browser 标签现在提供明确的“共享给 Agent”操作。Host 注册 `desktop_browser`，从执行中的 Agent 获取会话 ID，通过带关联 ID 的私有 IPC 请求主进程。主进程用 CDP 操作同一个实时 Electron 标签，保留当前页面与登录态，无需复制 cookie。停止共享、销毁标签和 Host 退出都会撤销访问并取消进行中的调用。Agent 默认仍使用独立浏览器；当前标签共享期间，独立浏览器 MCP 调用会被拒绝并提示使用共享工具。

## DSH Tako 桌面发行版

本仓库现在把官方 Desktop 外壳重新品牌化为 DSH Tako 发布：独立的产品名、应用 ID `tech.shiroha.dsh-tako`、数据目录 `~/.dsh-tako`、命令 `dsh-tako`、URL scheme 和 GitHub Releases 更新源，全部集中在 `apps/desktop/scripts/tako-desktop-identity.mjs` 和 `apps/desktop/src/tako-identity.ts`。上文关于 bundle 的决定仍然成立，Desktop 代码仍通过 merge 跟随官方版本。因此被放弃的“Fork 官方 Desktop 应用”指分叉 Desktop 代码路径，而不是发布独立品牌的构建。发行不使用官网命令安装和签名 CDN 清单；见[维护者指南](../../../../docs/tako/maintainers.zh.md)和[用户指南](../../../../docs/tako/user-guide.zh.md)。
