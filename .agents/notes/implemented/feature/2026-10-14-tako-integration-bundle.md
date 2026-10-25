# Agent Note: Tako integration bundle and first-run provider setup

Status: implemented

English | [中文](2026-10-14-tako-integration-bundle.zh.md)

## Problem

Tako needs to enter DSH as a provider-centered integration without forking the official Desktop host. A first launch also needs to configure the provider that the selected profile actually installs; always opening the official DeepSeek setup would make the Tako profile point users at the wrong account.

## Decision

The repository ships `@deepseek-ai/dsh-tako` as a profile bundle and runtime plugin. The `tako` profile composes the base and Web bundles, then mounts the Tako provider, bundled skill, and five Agent tools: search, image generation, speech transcription, speech generation, and read-only API-key quota. Text requests reuse the official OpenAI-compatible DSH adapter, while the Tako client resolves `TAKO_API_KEY` through DSH credentials for each operation and carries DSH session/turn correlation headers (plus tool-call headers for tools). Base64 image results use the existing DSH attachment service when present, so the native conversation renderer receives a durable image block instead of a text-only base64 marker.

The native Desktop welcome flow and Models settings client recognize the `llm-tako` namespace. Its first-run provider step selects the pathless Tako route when that route is present and otherwise selects the official DeepSeek route. The Tako editor writes the key through `credentials.set`, permits the endpoint field, and describes the server-owned model catalog without allowing the browser to replace it.

Model discovery reads Tako's public pricing directory first, falls back to the authenticated model directory, and keeps the last successful catalog when both endpoints are unavailable. Existing DSH providers remain available, and provider failures do not trigger an automatic provider switch. The intended Desktop journey is documented in [Tako Desktop User Flow](../../../../docs/tako-user-flow.md).

## Package topology

The host bundle lives in `packages/tako/tako`; `packages/boot/app-boot/src/profile.ts` owns the `tako` template, and the Desktop project manager injects the same bundle into its fixed `desktop` runtime profile. The browser onboarding behavior remains in `packages/client/ui-settings-models`, which already owns the Models page and first-run modal. This keeps the provider implementation independent of the browser renderer while allowing the existing credentials and settings protocols to own persistence.

The CLI entry has a keyless composition smoke in `apps/cli/tests/tako-profile.e2e.spec.ts`. It starts the source CLI, dumps the `tako` default layers, and asserts the Tako bundle and `TAKO_API_KEY` reference are present without making a paid request. Desktop packaging also roots its signed local package closure at `@deepseek-ai/dsh-tako`, so the fixed `desktop` profile can load the bundle after installation.

The bundle also exports release-manifest helpers that validate HTTPS artifact URLs, select domestic/overseas CDN fallbacks, enforce a minimum DSH version, and expose SHA-256 plus Ed25519 verification. The same seam parses a signed curated-plugin catalog and filters unattended installs to required, trusted entries with no extra permissions or build scripts. Desktop now gates candidate updates on an exact Tako-compatible DSH version and installed bundle version; macOS and Windows bootstrap sources verify the selected artifact before invoking the official installer. The helpers are installer primitives; publishing and signing the manifest and platform installers remains release infrastructure.

## Alternatives considered

**Fork the official Desktop application.** Rejected because the official Desktop already owns the Web surface and profile lifecycle. A bundle keeps updates and existing providers on the native DSH path.

**Treat Tako as an untyped custom provider.** Rejected because the provider needs a stable model catalog, credential reference, billed tools, correlation metadata, and a profile template; leaving it to the generic custom-provider form would lose those guarantees.

**Always show the official DeepSeek onboarding dialog.** Rejected because a Tako profile would ask for the wrong key. The onboarding target is derived from the provider directory and gives Tako precedence only when its pathless route is composed.

## Consequences

The first launch of `dsh --profile tako` can configure the Tako key without writing a secret into settings or chat history. API-key setup, endpoint editing, model selection, tool invocation, key-scoped quota reads, the redacted account quota card, read-only wallet balance and active plan projection, daily/weekly/monthly ledger fields, correlation-linked consumption receipts, image attachment rendering, durable generated-audio files when generic file attachments are mounted, and release-artifact verification follow existing DSH extension points and can be tested without a paid request. The release module now also executes the checked download → verify → configure → validate → start phase machine through caller-owned platform adapters. Desktop now owns a one-time loopback browser-login callback and a compatibility gate for official updates, while the published CDN manifest/signing, dynamic signed plugin-market recommendations, portal payment flows remain separate release work because their upstream contracts are not part of the current DSH/Tako API seam. Tako's local service separates JWT portal routes from the API-key gateway, so the bundle does not guess portal access from a `cr_` key or treat missing aggregates as zero. The `tako_usage` path does not replace Tako's account ledger.


The Desktop Browser tab now exposes an explicit Share with Agent action. The Host registers `desktop_browser`, derives the chat from the executing Agent, and sends correlated private IPC to the shell. The shell attaches CDP to the exact live Electron guest, retaining its page and login state without copying cookies. Stop sharing, guest destruction, and Host shutdown revoke access and cancel pending work. The isolated Agent browser remains the default; its MCP calls are refused while a live tab is shared, with an instruction to use the shared tool.
