---
description: "Preinstalled Tako Agent browser tools with an isolated Chromium profile."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-tako-browser-bundle

English | [中文](README.zh.md)

## Summary

The Tako profile ships with Agent browser tools enabled. Each Agent gets its own persistent Chromium profile by default. On Desktop, the user can choose **Share with Agent** in the Browser tab; `desktop_browser` then operates that same live tab and login state. **Stop sharing** or closing the tab revokes access without clearing browser storage.

The browser layer is optional to the DSH core. If Chromium cannot be started or downloaded, Tako text, image, speech, and search capabilities remain available and the browser can be retried later.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The Tako profile enables this bundle by default, so every Agent already has browser tools backed by its own persistent Chromium profile, isolated from other Agents. On Desktop, open the Browser tab and choose **Share with Agent** to let `desktop_browser` act on the live tab and its login state; **Stop sharing** or closing the tab revokes that access without clearing browser storage. Switching the bundle off removes the Agent browser tools and leaves the stored profiles untouched.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details — click to expand</summary>

The static `cordis.patch.yml` inserts two rows: `tako-agent-browser-use` mounting [`dsh-browser-use`](../../browser-use/browser-use/README.md), and `tako-agent-browser` mounting the experimental Playwright MCP browser provider in `launch` mode with `headless: true`. The Tako profile template carries this bundle in `TAKO_DEFAULT_BUNDLES` ([`dsh-official-bundles`](../../util/official-bundles/README.md)), so the plugin manager treats the installed copy as installation-owned.

</details>

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the mounted browser provider: Agents in the Tako profile gain the Playwright MCP browser tools and screenshots documented in [`dsh-experimental-browser-use-playwright-mcp`](../browser-use-playwright-mcp/README.md#model-experience).

#### KV Cache effect

Enabling or disabling this bundle adds or removes the browser tool schemas in Tako Agent sessions, which changes the cached request prefix of later requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The Agent browser always launches headless Chromium with one persistent profile per Agent; the Desktop **Share with Agent** path is the only way an Agent can act on the user's live tab and login state.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer details — click to expand</summary>

None.

</details>
