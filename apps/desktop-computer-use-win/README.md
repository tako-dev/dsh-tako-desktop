# Windows computer use (observation only)

English | [中文](README.zh.md)

An optional DSH bundle that gives the agent **read-only** access to the Windows desktop through the pinned [`dsh-computer-use-win`](https://www.npmjs.com/package/dsh-computer-use-win) MCP server (PowerShell UI Automation backend), bridged by `@deepseek-ai/dsh-mcp-client`.

## What the agent can do

Only observation tools are enabled: UIA accessibility tree, screen snapshots and screenshots, OCR, window listing, element lookup, and waits. They appear as `mcp__wincu__<tool>`.

## What is refused

Every input, mutation, and management tool upstream offers — click, type, drag, scroll, keypress, invoke, set value, window activate/close/move, app launch, batch, and the tool-management tool — is refused twice: naming one in `enabledTools` fails config validation before any process starts, and a call that still reaches the pipeline is denied by a pre-dispatch guard without contacting the upstream server. No kill or cancellation is used to enforce this, so an upstream `finally` (drag release, dialog restore) is never truncated.

## Shipping

Windows only (`os`, `dsh.bundle.platforms`). The default Desktop product does not carry this bundle; the Windows packaging gate includes its tarball only when `prepare-package-set.ts --with-computer-use-win` opts in, and the runtime lockfile is verified against the pinned upstream integrity. When shipped, the bundle is enabled per profile from the plugin manager, like other optional bundles.
