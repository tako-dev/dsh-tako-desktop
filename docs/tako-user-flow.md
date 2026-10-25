# Tako Desktop User Flow

English | [中文](tako-user-flow.zh.md)

> **Superseded.** This pre-implementation spec is kept as the design record. DSH Tako now ships as its own desktop application (app ID `tech.shiroha.dsh-tako`, data directory `~/.dsh-tako`, command `dsh-tako`) with installers and updates on GitHub Releases, not as a Tako bundle inside the official DSH installed by a website command. Statements below that DSH remains the official host, that macOS installs through a website command, or that the official app is not forked no longer describe the product. Current documentation: [user guide](tako/user-guide.md) and [maintainer guide](tako/maintainers.md).

This spec defines the target flow for ordinary users and records which parts are implemented in the current prototype. DSH remains the official host; Tako supplies isolated configuration, a model provider, a skills bundle, and curated plugin defaults. Users do not need to understand profiles, bundles, or MCP.

## Main user journey

| Stage | What the user sees and does | What the system does | Recovery path |
| --- | --- | --- | --- |
| Get and install | Windows users download and open the installer; macOS users copy one command from the website. Progress shows download, setup, and verification. | Selects a China or overseas CDN, installs a compatible official DSH, Tako bundle, and server-configured defaults, verifies them, and starts the app. | Names the failed component and offers Retry; optional browser components never block the workbench. |
| Connect Tako | One key field with **Connect and start**, plus **Sign in on the web** and **Configure later**. | Stores the key through the DSH credential service, validates it, and reads models and quota. | Separates an invalid key from a temporary network failure; offers edit, retry, or configure later. |
| First workbench | A recommended usable Tako model is selected and the user can type a task immediately; examples cover chat, search, images, and voice. | Enables the skills bundle and applies the default plugin configuration. It asks for a directory only when a task needs user files. | Explains why no model is usable and links to account settings; it never claims that a stored key alone means the service is ready. |
| Complete a task | The same Session shows progress, the answer, image/audio previews or a transcript, with files in the workspace. | The Agent chooses tools, reuses DSH retry behavior, sends correlation identifiers, and reports the backend usage receipt. | Keeps the conversation, names the failed capability, and offers a concrete recovery action; it never switches providers silently. |
| Manage account | Tako Settings shows plan, balance, quota, and daily/weekly/monthly usage; recharge and renewal open the official site. | Reads the Tako ledger and supports capability and model filters. | Shows “not available” and the last-read time instead of turning a failed request into a zero balance. |
| Extend and update | Plugins opens on Tako Curated with a link to the full community directory; a restart returns to the workbench. | Silently checks a compatible pair at startup and prompts only when an update exists; preserves the user's plugin choices. | Keeps the last valid manifest and runnable pair and exposes a repair action. |

## Proposed screens and transitions

This section proposes the visible layout around the agreed behavior. Review it in screen order; profile mounting, credential references, package selection, and browser transport remain engineering choices.

| Screen | Primary action | Secondary actions and state | Where the user goes next |
| --- | --- | --- | --- |
| Installation progress | Wait for core setup to complete | Show download, verification, configuration, validation, and launch phases; Retry only the failed component. The website command and Windows installer share the signed manifest and CDN fallback executor. | Launch directly into Connect Tako; optional components may remain pending. |
| Connect Tako | Paste key → Connect and start | Web sign-in is the fallback; Configure later is always visible. No endpoint, provider ID, or profile selector is required. | Verified access opens the workbench; Configure later opens it with Tako marked Not configured. |
| Workbench | Type a task in the existing DSH composer | Show the selected model and a compact Tako status. Suggested examples fill the composer and do not execute until sent. | Answers and tool results remain in the same conversation. |
| Results | Read, preview, play, or open a generated file | Search shows citations; images and audio show previews. One shared usage receipt shows backend status, including Pending when settlement is delayed. | Continue the task without switching to a separate image, speech, or search app. |
| Settings → Tako | Inspect account and usage | Replace key, switch account, refresh quota, and open the official payment page. Use daily, weekly, or monthly filters with capability and model filters. | Closing settings restores the previous conversation. |
| Plugins → Tako Curated | Use the installed defaults or add a selected plugin | Keep access to the full community directory; distinguish Downloading, Installed, Enabled, and Failed. Default entries finish enabled without an extra setup action. | Return to the workbench; new capabilities are available there. |
| Browser tab | Browse normally; explicitly share the live tab with the Agent when needed | Show User or Agent and Isolated or Shared. Sharing attaches the Agent to this tab's live Electron WebView and login state; stopping or closing the tab revokes it. | Closing a tab closes the page; it does not silently clear the persistent browser data. |

## First-task walkthrough for review

Review the screens through one new user's task: install the app, paste a key, then ask “Find what I need for a weekend camping trip, make a checklist image, and generate a spoken reminder.” This is a proposed experience walkthrough, not a recorded working demo.

| Step | Screen and user action | Observable completion |
| --- | --- | --- |
| 1. Installation finishes | Core readiness opens Connect Tako automatically; an unfinished browser download remains Pending. | No DeepSeek sign-in, marketplace visit, or endpoint entry is required first. |
| 2. Connect the account | Paste a key and select Connect and start; the button shows Checking and Configure later remains available. | A valid credential with a usable model opens the workbench; a failed quota read is shown separately from an invalid key. |
| 3. Write the first task | The existing DSH composer occupies the center with a usable recommended model selected; an example can fill the composer for editing. | Sending a task requires no prior skill selection, browser configuration, or project creation. Without a chosen folder, the default output location must be visible and openable; its exact location remains a walkthrough decision. |
| 4. Observe execution | The current conversation shows actual search, image, and speech calls and their results; only capabilities chosen by the model execute. | There are no three separate feature pages or manual image-link transfers to a speech feature. Sources, the checklist image, and audio playback remain in this conversation. |
| 5. Inspect results and usage | Open the checklist image, play the audio, and expand shared usage details; account settings provides aggregates. | Consumption values require backend receipts; Pending is distinct from zero usage. Closing account settings returns to this task. |
| 6. Continue or leave | Ask “Adapt the checklist for a trip with children,” or close the app and return later. | The conversation retains its context; a restart makes previous results discoverable, preserves the model choice, and does not repeat completed Tako setup. |

A browser task branches within the same conversation: the user requests web interaction → the Agent uses its persistent browser → the user can inspect progress and stop the task. A Browser tab opened by the user still belongs to the user browser; letting the Agent use that browser is an explicit sharing action. Opening a tab alone must not change login-state ownership. The live bridge shows the current tab and login state as shared, and revokes that grant when the user stops sharing or closes the tab.

## Failure and return paths

A failure remains in its owning page or conversation and offers a next action. This table adds navigation behavior; retry counts and backoff continue to use DSH.

| Situation | What the user sees | Next action and retained state |
| --- | --- | --- |
| Invalid key or connection timeout | Separate messages to edit the key or retry a temporarily unavailable connection. | Edit, retry, or configure later; keep any unsent task. |
| Browser sign-in is canceled, times out, or loses its callback | The connection page retains the primary paste-key route. | Retry sign-in or use a key; having opened the website does not mean sign-in succeeded. |
| Connected account but unavailable model directory | A stale cached directory, or a fetch failure when no cache exists. | Keep the model choice and offer Refresh; neither switch providers automatically nor treat public recommendations as authorization. |
| Browser download or startup fails | The browser capability shows Pending or Unavailable with Retry. | Ordinary chat, Tako API search, image generation, and speech can still create and use Sessions; browser initialization must not block every new task. |
| Search succeeds but image generation fails | Keep search results and citations, with the cause shown on the image call. | Continue in the same conversation without restarting the whole task to complete one image. |
| The user opens recharge after exhausting quota | Payment happens in the system browser while the app retains the conversation and draft. | Refresh quota on return and let the user continue; refreshing alone does not rerun paid requests. |
| A curated plugin fails to install | Its card shows the failure while other enabled plugins remain usable. | Retry the failed item or return to the workbench; Downloaded, Installed, and Enabled are distinct states. |

Connection checks must separate stored credentials from verified access. A successful key check with no usable model shows the model or quota reason and the account action. A successful key check with a failed quota read shows Quota unavailable without declaring the key invalid. A timeout preserves the draft and offers Retry or Configure later; a rejected key offers Edit key. No validation step sends an unsolicited paid generation request.

After a previous successful setup, startup returns to the workbench with the user's model choice. An expired credential produces a recoverable Tako status there rather than hiding existing conversations. Whether Configure later persists across future launches remains a product decision; the current interview only establishes that it permits entry during the current launch.

## Host integration questions

The release unit remains one top-level Tako bundle. These source findings constrain its integration; they do not authorize a fork of the official app or a reduction of the agreed flow.

| Required experience | Official source finding | Design consequence |
| --- | --- | --- |
| First screen asks for Tako credentials | Native Welcome runs before the workbench, and [Models onboarding registration](../packages/client/ui-settings-models/src/client/index.ts) disables automatic credential onboarding on Desktop. | A Web settings patch alone cannot replace native first launch. Verify a supported host hook before promising this as a bundle-only feature. |
| The existing DSH installation stays independent | Desktop uses a fixed desktop profile and [single-instance ownership](../apps/desktop/src/single-instance.ts); the project manager injects the Tako bundle into that profile. | Keep the data directory and application-instance checks, and include the Tako bundle in the signed runtime package set. A separately named CLI profile is still not a user-selectable Desktop profile. |
| The market entry is removable while Tako core stays required | The [plugin manager](../packages/boot/plugin-manager/src/index.ts) protects management modules and their containing bundles. | Keep the optional Tako curated entry separate from the protected recovery/management implementation; verify what can actually be removed. |
| Users browse, Agents operate, and sharing is deliberate | The sidebar is an Electron webview; Desktop now exposes an explicit lease-scoped CDP bridge to the Host tool. | The default remains isolated. A user action grants the current chat access to the live tab; revocation and guest destruction terminate the bridge. |
| DSH and Tako update as a compatible pair | The [Desktop updater](../apps/desktop/src/update-coordinator.ts) owns host releases independently of profile plugins. | Verify the supported update integration and failure recovery before claiming that a compatibility manifest controls both. |

The walkthrough above now anchors the implementation. Connect Tako, the provider/tool path, the redacted quota card, daily/weekly/monthly usage, correlation-linked consumption receipts, persistent user-browser storage, Agent profile isolation, the Tako-curated first screen, the installer phase executor, the one-time loopback browser-login callback, and the explicit live-tab sharing bridge are covered by code and tests. Publishing the real signed website manifest, platform installer adapters, dynamic signed curated catalog, and a full Desktop run remain release acceptance work.

## Checks against the official code

The comparison baseline is official tag `dsh-v0.2.1-alpha.2` (2026-10-09), confirmed against the current official commit after fetching remote references on 2026-10-14. Source was read from the official Git revision; uncommitted local Tako changes are not evidence of upstream support. The entries below describe source behavior; the target journey still requires a real Desktop acceptance run.

| Official behavior and evidence | Impact on the target journey |
| --- | --- |
| The [welcome backend](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.2/apps/desktop/src/welcome-backend.ts) reads credential state for configurable providers, but the native key form writes the `llm-deepseek` reference; the [welcome condition](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.2/apps/desktop/src/welcome-api.ts) enters onboarding only when neither an account nor any key is configured. | Tako needs its own key form. A Tako key cannot be written through the native DeepSeek form, and any arbitrary configured key cannot be treated as Tako-ready. Whether a no-key cold start can land directly on Tako setup still needs an approved host extension point. |
| The [upstream Desktop paths](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.2/apps/desktop/src/paths.ts) are fixed to `profiles/desktop` under the DSH data directory, and the [Desktop Host](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.2/apps/desktop-host/src/index.ts) starts the `desktop` profile. | The current project manager injects the Tako bundle into that fixed profile and the package-set builder roots `@deepseek-ai/dsh-tako`; creating a separately named CLI `tako` profile still does not make the upstream Desktop selectable. Keep the data-directory and single-instance checks in release acceptance. |
| The [plugin manager](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.2/packages/client/ui-plugin-manager/README.md) already provides install, enable, configure, remove, progress, and registry selection. Manual installation still has a separate **Enable now** action. | Reuse the manager, but make the Tako default manifest complete the install-and-enable path; curated ordering and a full community-directory entry remain additive work. |
| The [upstream built-in browser](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.2/packages/client/ui-sidebar-browser/README.md) is a right-sidebar tab. Its original Desktop implementation used process-local Electron webview storage and did not register Agent tools. | This branch gives user tabs a hashed, workspace-scoped `persist:` partition and a user-triggered lease-scoped CDP bridge. Agent control runs through `desktop_browser` against the selected live guest; the isolated Playwright runtime remains the default. |
| The [Playwright browser provider](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.2/packages/experimental/browser-use-playwright-mcp/README.md) supports launch/attach, but its mode is fixed when activated and reload does not promise cookie or page restoration. | The isolated Playwright runtime remains the default, while the Desktop bridge is the explicit path for a user-selected live tab; installing two browser packages is not an acceptance criterion. |
| That Playwright provider propagates startup failure to Session creation or resume; its [source](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.2/packages/experimental/browser-use-playwright-mcp/src/index.ts) must be checked alongside its runtime. | A failed download cannot leave a failing browser mounted on every Session. Ordinary Sessions must remain available without a ready browser; gate mounting on readiness or defer startup, then verify recovery. |
| Native Welcome skips directly to the workbench; its [API](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.2/apps/desktop/src/welcome-api.ts) explicitly stores no onboarding-completion state. | Suppressing setup on future launches after Configure later is not an existing guarantee. Remembering the choice while keeping a workbench setup entry is proposed and remains a product decision. |
| The current Plugins page presents official entries and installed bundles and accepts installation sources; the source review above does not establish a complete community-market index. | Reuse installation management; selecting the market plugin or service that supplies the full community directory remains open. An npm mirror selector is not a community market, and installing a market plugin does not itself connect curated entries. |

These integration points are resolved through code and prototype checks without exposing implementation choices to users. If the official extension points are insufficient, record the exact gap and review the smallest host change; this draft does not assume modifying the official binary.

## Backend contract check

The local Tako service source separates the user portal from the OpenAI-compatible key gateway. The portal exposes JWT-authenticated plan, subscription, usage, logs, and model routes under `/par/user/*`; the DSH plugin only has the API key contract, so it must not guess that a `cr_` key can call portal routes or fabricate a browser session. The API-key ledger now exposes daily, weekly, and monthly aggregates, and the DSH account page reads the monthly fields. Portal authentication, capability/model filters, and receipt lookup remain integration questions; the website login route now supports the one-time loopback callback used by Desktop. Missing APIs do not silently reduce the requirement to an external account link.

Tako's service notes identify Sub2API `usage_logs` as the consumption authority and describe window, daily, weekly, monthly, and total aggregates as derived views. The DSH correlation identifiers now form a stable opaque request id (`dsh-` plus a SHA-256 digest). Tako accepts that id on the API gateway, stores it as the request id in the consumption log, and exposes a read-only `/apiStats/api/receipt` projection. The API-key `user-quota` projection also returns read-only wallet balance, used amount, active plan titles, and expiry times; those fields never authorize payment. A receipt can be **Pending** while the asynchronous ledger settles or **Unavailable** when the backend cannot answer; neither state is rendered as zero usage.

## First launch

The target Windows entry is a one-click installer. macOS phase one is a one-line command from the website that chooses a China or overseas CDN; a signed DMG can follow. The user does not need Node.js or pnpm. `apps/desktop/scripts/tako-install-windows.ps1` and `tako-install-macos.sh` now connect manifest lookup, China/overseas fallback, HTTPS and SHA-256 checks, official installer execution, and launch. Both assume the DSH artifact already carries the Tako runtime package set and never run unapproved pnpm mutations inside a user's profile. The bundle still provides manifest parsing, compatibility checks, and a download → verify → configure → validate → start executor. The current Desktop project manager maps the Tako bundle into the fixed `desktop` profile and the package-set builder includes its tarball; publishing the real website manifest, signing material, and cross-platform installer qualification remain release work.

The first screen is the Tako setup page. It asks for a Tako API key and keeps profile names in diagnostics rather than the ordinary setup path. Pasting the key is the primary route; DSH stores it through its credential service under the `TAKO_API_KEY` reference and never writes the value into profile settings, session text, tool output, or diagnostics. A failed validation keeps the user on the page with an actionable error. The user may continue into the workbench with Tako marked **Not configured**, then configure it from Settings.

The target first-run page shows one Tako setup and does not require a DeepSeek account. Web sign-in is the selected fallback: open the official Tako login page in the system browser, return through a one-time loopback callback, and reuse the credential service. Desktop and the Tako website now implement this handoff; a failed or expired callback leaves the paste-key route available.

## Workbench entry

After setup succeeds, the application opens the ordinary DSH workbench with the isolated Tako configuration selected. Existing DSH providers remain available. Tako is the default provider only in this configuration; the initial model is selected from the account's usable recommendations and the user's later choice is retained. A request failure shows the Tako error and leaves provider switching to the user.

The workbench displays a compact Tako status in the account/settings entry: configured or not configured, last catalog refresh, and the latest quota read. A missing or invalid key never blocks access to sessions, files, plugins, or other providers.

## Model selection

The model selector reads Tako's live model directory. The public `GET /api/pricing` directory may supply metadata; the authenticated `/v1/models` and account endpoints confirm the key's model permissions and quota. A public group listing does not prove that the current account is entitled to use it. Rows show recommendation and only evidence-backed availability; an unreported state is **Unknown**, not an inference from a model name or marketing tag.

An offline catalog keeps the last successful directory and marks it stale. The user may inspect stale rows, but a model absent from the last successful directory cannot be called. On a first launch with no directory, the selector shows Retry instead of treating bundle recommendations as authorization. A successful refresh replaces the cache. The selector never silently changes the selected provider when a Tako request fails.

## Agent capabilities

The bundle enables the complete Tako skills set automatically: web search, image generation, speech transcription, speech generation, and read-only quota. Phase one does not add dynamic capability discovery. The model decides when to call tools, and a call consumes its corresponding quota without an extra per-call confirmation. Search results retain sources for citations. Images and generated audio enter the current conversation as previews and workspace files; transcriptions enter as readable text. Each successful media result offers Open or Save. An attachment, download, or playback integration gap remains unfinished work, rather than changing this requirement to raw structured data.

Text and tool requests carry DSH session and turn identifiers when they are scheduled by the Agent loop, plus a tool-call identifier for tool calls; standalone calls omit the unavailable fields. Tako remains the only consumption ledger; the bundle reads the current receipt and account aggregates from Tako. The read-only quota tool reads the key-scoped endpoint when the user asks about capacity. The bundle does not maintain a second local usage database.

## Account and payment

Settings contains a Tako account page with key status, plan, balance, quota, model limits, and the expiration returned by the backend. The API-key ledger now supplies daily, weekly, and monthly windows, which the account page displays; capability and model filters wait for corresponding backend fields. Recharge and renewal open the official Tako page in the system browser, with a refresh action on return. One installation has one current Tako account; switching accounts re-authenticates and clears the old account's display cache. The plugin provides no automated login, account mutation, model-switch, or payment tool; this does not restrict general browser use.

## Plugins and browser

The DSH Plugins page remains the management surface and reuses the community market. The current build puts the Tako bundle's shipped picks in a first group and keeps the full community directory. The release helper verifies a signed, versioned remote catalog; wiring its publication URL and key set is still release work. The shipped safe defaults cover the first install until the server catalog is available, without changing the user flow. Later manifest changes may auto-reinstall only entries marked **Required**; other additions require confirmation. Only the Tako core is non-removable; the market entry and other plugins can be removed. **Required** does not automatically mean **user cannot remove it**; the reinstall policy after a deliberate removal is an installer decision that must be made explicit.

Trusted entries install automatically; extra permissions or build scripts require confirmation. A signature or version check failure stops automatic installation and keeps the last valid manifest.

The user browser is a closable Browser tab inside the DSH workspace. The user and Agent browsers use separate persistent profiles by default and do not share cookies, storage, or login state unless the user explicitly chooses to share them. Sharing attaches the current chat to the selected Electron guest over private Host IPC and CDP; closing the guest, stopping sharing, or Host shutdown revokes access. Agent browser actions run automatically; the user can see the isolation/share mode and stop an in-progress task through DSH. The runtime prefers an installed Chrome or Chromium and can download a fixed Tako-pinned version when none is available. A browser download failure does not roll back the Tako core; the browser entry remains pending and offers Retry.

## Update and recovery

At startup the application silently checks a compatibility manifest and prompts when a new DSH/Tako pair exists. Before the official Desktop updater presents a candidate, it reads the HTTPS manifest configured by `TAKO_RELEASE_MANIFEST_URL`, requires an exact `dshVersion` match, and requires the bundle version to match the Tako package in the signed runtime. A missing or mismatched manifest hides the candidate; a manual check exposes a recoverable error. Development builds without the manifest URL keep the official updater behavior. After confirmation it updates the pair together; failure leaves the runnable pair and user data intact. Installer rollback scope, interrupted-update recovery, and the official single-instance behavior are release checks.

## Acceptance checks

- A Windows installer or one-line macOS command ends at Tako setup; configuring a key requires no terminal and no DeepSeek account.
- A key validation failure still permits entry to the workbench and offers a visible repair path.
- The model selector distinguishes live, stale, recommended, unknown, and unavailable models, and does not treat the public directory as account authorization.
- Search, image, audio, and quota calls appear in the current turn with stable correlation identifiers and no secret leakage.
- The Tako account page shows daily/weekly/monthly backend aggregates and links payment to the official site; each tool result carries a correlation-linked receipt state, and settled cost/token data comes from Tako's `/apiStats/api/receipt` endpoint.
- The curated-list helper enforces signatures and versions; before publication, recovery uses the last valid catalog and shipped safe defaults.
- User and Agent browser storage are isolated and survive restart by default; sharing requires an explicit choice, and a missing browser runtime does not prevent the core application from launching.
- A second launch with a configured Tako account opens the workbench directly, and another DSH installation is unaffected.
