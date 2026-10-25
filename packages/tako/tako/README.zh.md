---
description: "面向 DSH 的 Tako profile bundle：提供默认文本模型、计费搜索、生图、语音和额度工具，供组合或定制 profile 使用。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-tako

[English](README.md) | 中文

<a id="summary"></a>
## 概述

这个 bundle 为 DSH profile 增加 Tako 文本 provider、模型目录、skills，以及计费搜索、生图、语音和额度工具。通过 profile 插件管理器或内置 `tako` profile 添加；内置 Tako profile 会保护这个核心 bundle，可选配套插件仍可移除。原有 DSH provider 继续可用，Tako 凭据继续由 DSH credential service 保存。包内包含运行时和安装器基础能力；签名平台发布、loopback 网页登录回调和账号门户接入由 Desktop 负责。

<a id="table-of-contents"></a>
## 目录

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

### Install into a profile

在 workspace build artifact 重新生成期间，profile 组合 smoke 使用 source CLI：

```bash
pnpm exec vitest run packages/tako/tako/tests/api.spec.ts packages/tako/tako/tests/tools.spec.ts
node --import tsx/esm apps/cli/src/bin.ts --profile tako --dump-default-config
```

发布后的安装使用正常的 profile plugin manager：

```bash
dsh plugin --profile tako add @deepseek-ai/dsh-tako
dsh plugin --profile tako remove @deepseek-ai/dsh-tako
```

`packages/boot/app-boot/src/profile.ts` 负责组合 `tako` profile。patch 会插入带 `TAKO_API_KEY` credential reference 的 provider 行；如果缺少 `dsh.bundle.patch` 声明，bundle reconciler 会拒绝它，而不会把它当普通插件挂载。

### What you get

这个 bundle 增加 `tako` 文本 provider、实时或缓存的模型目录，以及 `tako_search`、`tako_image`、`tako_transcribe`、`tako_speech` 和只读的 `tako_usage` 工具。Models 设置页负责 key 编辑和首次配置路径，运行时包负责 API 调用、关联请求头和工具渲染。可用时 base64 图片通过 DSH 附件服务处理；搜索结果保留来源 URL 供引用。

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>实现细节 — 点击展开</summary>

patch 文档用 `apiKeyEnv: TAKO_API_KEY` 和 Tako 公网地址插入 `tako`。`src/index.ts` 注册 provider、目录刷新、DSH OpenAI 兼容 adapter、内置 skill 和工具。`src/api.ts` 规范化 `/v1`，每次操作解析凭据，映射稳定错误码，并附加 session、turn 和 tool-call 请求头。`src/release.ts` 校验 HTTPS artifact、CDN 回退顺序、版本约束、哈希、签名和带签名的优选插件目录。Desktop 能否选择 profile 仍由宿主决定。

</details>

<a id="further-exploration"></a>
## Further Exploration

修改安装界面前先阅读 [Tako Desktop 用户流程](../../../docs/tako-user-flow.zh.md)、[profile 组合](../../../packages/boot/app-boot/src/profile.ts)、[bundle patch](cordis.patch.yml) 和 [Tako skill](skills/tako/SKILL.md)。

<a id="model-experience"></a>
## Model Experience

### Tako capability bundle

#### What the model sees

`tako` profile 在可用时暴露实时模型目录和五个 Tako 工具。搜索返回来源 URL；生图结果可以成为 DSH 附件；语音工具返回结构化转写或音频数据；额度读取是只读的。

##### Capability surface

```markdown
tako model catalog and five capability tools
```

#### Token effect

文本把 Tako 当作普通 provider。内置 skill 和工具 schema 只增加一小段稳定 prompt 前缀，每个工具结果只把选中的搜索或媒体输出追加到当前 turn。

##### Prompt and result

```markdown
small stable skill prefix; selected tool result
```

#### KV Cache effect

切换 Tako 模型会改变 provider 路由，可能影响 provider 侧的前缀复用。工具结果只改变调用之后的请求后缀，不改写之前的 turn。

##### Cache boundary

```markdown
provider route changes; tool output appends after the call
```

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- 这个包还没有发布签名 release manifest、Windows 安装器、macOS 命令或 CDN artifact；公开宣传一键安装前必须先配置发布基础设施。
- 官方 Desktop 仍启动固定的 `desktop` profile；Desktop project manager 现在会把这个 Tako bundle 注入该固定 profile。单独可选择的 `tako` profile 仍是 CLI 组合，签名 runtime package set 也必须包含这个 bundle。
- API-key 服务现在提供日/周/月聚合和只读关联回执接口；账户卡读取聚合字段，每个计费工具返回待结算、不可用或已结算回执。门户鉴权、能力/模型筛选、优选插件市场投递以及用户/Agent 浏览器共享仍需要当前包没有的宿主或后端契约。挂载 DSH 通用文件附件服务时，生成音频会持久化为文件；没有该服务时工具保留有界的提供方 payload。URL 图片会保留为链接，不会从不受信路径下载。
- 音频接口是否可用取决于 Tako 账号是否开放文档中的上游路由。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

API 测试会 mock `fetch`，不需要 key，也不会发起付费请求。不要把 `TAKO_API_KEY` 写进 settings snapshot、日志、工具输出或文档示例。修改时同时更新中英文 README，然后运行 `pnpm exec tsx scripts/verify-translation-pairing.ts --write packages/tako/tako/README.md` 重新记录 `README.i18n.yaml`。

</details>
