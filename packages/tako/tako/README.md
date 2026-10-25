---
description: "The Tako profile bundle for DSH: a default text provider with billed search, image, speech, and quota tools, for users composing or customizing a profile."
kind: "package-bundle"
---

# @deepseek-ai/dsh-tako

English | [中文](README.zh.md)

<a id="summary"></a>
## Summary

This bundle adds a Tako text provider, model catalog, skills, and billed search, image, speech, and quota tools to a DSH profile. Add it through the profile plugin manager or the shipped `tako` profile; the shipped Tako profile protects this core bundle while optional companion plugins remain removable. Existing DSH providers remain available, while Tako credentials stay in the DSH credential service. The package contains runtime and installer primitives; Desktop owns the signed platform release, loopback browser-login handoff, and account portal integration.

<a id="table-of-contents"></a>
## Table of Contents

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

The profile composition smoke uses the source CLI while workspace build artifacts are being regenerated:

```bash
pnpm exec vitest run packages/tako/tako/tests/api.spec.ts packages/tako/tako/tests/tools.spec.ts
node --import tsx/esm apps/cli/src/bin.ts --profile tako --dump-default-config
```

A published install uses the normal profile plugin manager:

```bash
dsh plugin --profile tako add @deepseek-ai/dsh-tako
dsh plugin --profile tako remove @deepseek-ai/dsh-tako
```

The `tako` profile is composed by `packages/boot/app-boot/src/profile.ts`. The patch inserts one provider row with the `TAKO_API_KEY` credential reference; a missing `dsh.bundle.patch` declaration is rejected by the bundle reconciler instead of being mounted as an ordinary plugin.

### What you get

The bundle adds the `tako` text provider and a live-or-cached model directory, plus `tako_search`, `tako_image`, `tako_transcribe`, `tako_speech`, and read-only `tako_usage` tools. The Models settings page owns the key editor and first-run route, while the runtime package owns API calls, correlation headers, and tool rendering. Base64 images use DSH's attachment service when available; search results retain source URLs for citation.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The patch document inserts `tako` with `apiKeyEnv: TAKO_API_KEY` and the public Tako base URL. `src/index.ts` registers the provider, catalog refresh, DSH OpenAI-compatible adapter, embedded skill, and tools. `src/api.ts` normalizes `/v1`, resolves credentials per operation, maps stable error codes, and attaches session, turn, and tool-call headers. `src/release.ts` validates HTTPS artifacts, CDN fallback order, version constraints, hashes, signatures, and the signed curated-plugin catalog. The host still decides whether a profile can be selected by Desktop.

</details>

<a id="further-exploration"></a>
## Further Exploration

Read the [Tako Desktop user flow](../../../docs/tako-user-flow.md), the [profile composition](../../../packages/boot/app-boot/src/profile.ts), the [bundle patch](cordis.patch.yml), and the [Tako skill](skills/tako/SKILL.md) before changing the install surface.

<a id="model-experience"></a>
## Model Experience

### Tako capability bundle

#### What the model sees

The `tako` profile exposes the live model catalog when available and the five Tako tools. Search returns source URLs; image results can become DSH attachments; speech tools return structured transcription or audio data; quota reads are read-only.

##### Capability surface

```markdown
tako model catalog and five capability tools
```

#### Token effect

Text uses Tako as an ordinary provider. The embedded skill and tool schemas add a small stable prompt prefix, while each tool result appends only the selected search or media output to the current turn.

##### Prompt and result

```markdown
small stable skill prefix; selected tool result
```

#### KV Cache effect

Changing the selected Tako model changes the provider route and may invalidate provider-side prefix reuse. Tool results change only the request suffix after the call and do not rewrite earlier turns.

##### Cache boundary

```markdown
provider route changes; tool output appends after the call
```

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The package does not publish a signed release manifest, Windows installer, macOS command, or CDN artifacts; release infrastructure must configure those before a public one-click install can be advertised.
- Official Desktop still starts the fixed `desktop` profile; the Desktop project manager now injects this Tako bundle into that fixed profile. A separately selectable `tako` profile remains a CLI composition, and the signed runtime package set must include the bundle.
- The API-key service now exposes daily/weekly/monthly aggregates and a read-only correlation receipt endpoint; the account card reads the aggregates and each billed tool returns Pending, Unavailable, or settled receipt data. Portal authentication, capability/model filters, curated plugin-market delivery, and user/Agent browser sharing still require host or backend contracts that are not present in this package. Generated audio is persisted through DSH's generic file attachment service when mounted; without that service the tool keeps a bounded provider payload. URL-only images remain links instead of being downloaded through an untrusted path.
- Audio endpoint availability depends on the Tako account exposing the documented upstream routes.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The API tests mock `fetch` and do not need a key or paid request. Keep `TAKO_API_KEY` out of settings snapshots, logs, tool output, and documentation examples. Update the English and Chinese README together, then re-record `README.i18n.yaml` with `pnpm exec tsx scripts/verify-translation-pairing.ts --write packages/tako/tako/README.md`.

</details>
