# DSH Tako User Guide

English | [中文](user-guide.zh.md)

DSH Tako is an unofficial desktop agent application built on DeepSeek Harness (MIT) with Tako models and Tako tools built in. It is not affiliated with or endorsed by DeepSeek. This guide covers installation, sign-in, features, uninstallation, and troubleshooting; maintainers should read the [maintainer guide](maintainers.md).

![DSH Tako welcome screen](images/01-welcome.png)

![DSH Tako workspace](images/02-workspace.png)

## Download and install

Installers are published on [GitHub Releases](https://github.com/tako-dev/dsh-tako-desktop/releases). Each version contains:

| System | Download | Notes |
|---|---|---|
| macOS (Apple Silicon, M-series) | `DSH-Tako-<version>-mac-arm64.dmg` | Signed and notarized; if only `-unsigned.dmg` is present, see "Unsigned macOS builds" below |
| Windows 10/11 (x64) | `DSH-Tako-<version>-win-x64.exe` | Not code-signed |

The `latest.yml`, `latest-mac.yml`, `.zip`, and `.blockmap` files feed in-app updates and need no manual download. `SHA256SUMS.txt` lists each file's SHA-256; compare with `shasum -a 256 <file>` (macOS) or `Get-FileHash <file>` (Windows). Intel Mac and Linux installers are not provided.

**macOS**: open the dmg, drag DSH Tako to Applications, then open it from Applications or Launchpad. Do not run it from the dmg window.

**Windows**: run the exe. The installer is unsigned, so Windows SmartScreen may show "Windows protected your PC": choose More info, then Run anyway. It installs for the current user under `%LOCALAPPDATA%\Programs\DSH Tako` without administrator rights.

**Unsigned macOS builds**: if a version offers only `DSH-Tako-<version>-mac-arm64-unsigned.dmg`, macOS blocks the first launch. Open it once, then go to System Settings → Privacy & Security and choose Open Anyway near the bottom. Unsigned builds do not update automatically; download and install each new version manually.

## First sign-in

If you never pick a model, new chats use Tako **`deepseek-v4.1-flash`**. Check for updates under **Settings → General** (button next to the version) or the application menu.

The first launch shows a welcome screen with two ways to connect Tako:

1. **Sign in with Tako in browser**: the app opens the Tako authorization page in your default browser. After you sign in and approve, the browser hands the result back to DSH Tako on this computer, which stores the API key and opens the workspace. Authorization must finish within 10 minutes; after a timeout you can retry.
2. **Paste Tako API key**: get an API key from the Tako website, choose Paste Tako API key, paste it, and choose Save and continue. The app validates the key with Tako before storing it.

The API key is kept in DSH credential storage, never in settings files or chat history. You can replace it later under Settings → Models.

A key created by browser sign-in uses `DSH-Tako@<host name>` as its device name (`DSH-Tako@<platform>` when no host name is available), shown on the Tako authorization page. Signing in again on the same machine replaces that machine's previous key, which stops working; different machines use different device names and do not affect each other.

Arc and similar browsers may open the authorization page in a small popup window (for example Little Arc) instead of a normal tab. Finish signing in and approving in that window; if you missed the popup, switch to the browser and look for it. Then return to DSH Tako.

## Features

### Tako models

DSH Tako uses the `tako` model provider by default. The Tako service manages the available models: the app reads the model directory at startup and keeps the last successful directory when a read fails. Choose a model from the model menu at the bottom right of the composer ("Select model" appears when none is chosen). Other providers such as DeepSeek remain configurable under Settings → Models.

### Five Tako tools

The agent calls these tools as the task requires; you do not pick them manually. Every call except the quota query is billed to the Tako account.

| Tool | Purpose | Main parameters |
|---|---|---|
| `tako_search` search | Web search returning a summary and source links that the answer cites | `query`; `count` sources (1–20) |
| `tako_image` image generation | Generates an image shown in the conversation | `prompt`; `model` defaults to `gpt-image-2`; `size` such as `1024x1024`; `n` count |
| `tako_transcribe` speech recognition | Transcribes audio to text | `audioBase64`; optional `filename`, `mimeType`, `model`, `language` |
| `tako_speech` speech synthesis | Turns text into playable audio | `text`; optional `model`, `voice`, `format` (default `mp3`) |
| `tako_usage` quota query | Reads the current API key's quota without a billed request | none |

For example, "Search this weekend's weather in Beijing, make a packing-list image, and generate a spoken reminder" makes the agent call search, image generation, and speech synthesis in turn, and every result stays in the same conversation.

### Account and quota

The octopus at the bottom of the sidebar is drawn by the **npm plugin**: with a plan it shows remaining **5h** and **weekly** bars plus wallet balance. The 5h/week numbers are subscription windows (same as the Tako plan page); wallet remainder is a different figure. Recharging and plan changes happen on the Tako website. Click the octopus to open the Tako console.

### Everything else

The plugin market, automated tasks, workspaces, the built-in browser, and the `dsh-tako` terminal command come from the DeepSeek Harness desktop. A built-in browser tab can be explicitly shared with the agent, which then operates that tab's page and login state; stopping sharing or closing the tab revokes access.

## Difference from the npm plugin dsh-tako

The npm plugin `dsh-tako` is a lightweight plugin for the **official** DSH that only adds Tako models to it. DSH Tako is a **complete desktop application**: besides Tako models it includes browser sign-in, the five Tako tools, the quota card, the Tako-branded interface, and its own automatic updates. Both can be used at the same time; if you only want Tako models inside the official DSH, the plugin is enough.

Note the name: the terminal command DSH Tako installs is also called `dsh-tako`. It starts the runtime bundled with DSH Tako and is unrelated to the npm package of the same name.

## Running beside the official DSH

DSH Tako and the official DSH desktop can be installed and run at the same time without affecting each other:

| Item | DSH Tako | Official DSH |
|---|---|---|
| App ID | `tech.shiroha.dsh-tako` | `com.deepseek.harness` |
| Data directory (settings, sessions, credentials) | `~/.dsh-tako` | `~/.dsh` |
| Terminal command | `dsh-tako` | `dsh` |
| URL scheme | `dsh-tako://` | `dsh://` |
| Update source | This repository's GitHub Releases | The official update service |

When the `DSH_HOME` environment variable is set, DSH Tako uses that directory instead of `~/.dsh-tako`.

## Uninstall

**macOS**

1. Quit DSH Tako and move DSH Tako from Applications to the Trash.
2. If you installed the terminal command, remove `/usr/local/bin/dsh-tako` (requires an administrator password: `sudo rm /usr/local/bin/dsh-tako`).
3. To remove all data, also delete `~/.dsh-tako` (sessions, settings, and the API key), `~/Library/Application Support/DSH Tako`, `~/Library/Caches/dsh-tako-desktop-updater`, and `~/Library/Logs/DSH Tako`.

**Windows**

1. Quit DSH Tako (including its system tray icon) and uninstall DSH Tako under Settings → Apps → Installed apps.
2. To remove all data, also delete `%USERPROFILE%\.dsh-tako` (sessions, settings, and the API key), `%APPDATA%\DSH Tako`, and `%LOCALAPPDATA%\dsh-tako-desktop-updater`.

Deleting these directories does not touch the official DSH's `~/.dsh`.

## FAQ and troubleshooting

**The browser sign-in does not return to the app.** The authorization result reaches the app through a loopback address on this computer; once the browser page reports completion, switch back to DSH Tako yourself. If the app keeps waiting, check whether the authorization page is still open in a popup or another browser window; a proxy or security software may block local loopback requests; the attempt times out after 10 minutes. You can always use Paste Tako API key instead.

**The key is reported invalid or expired.** Make sure you copied the complete Tako API key without extra spaces, and confirm on the Tako website that it has not been deleted or disabled. "Could not reach Tako" is a network problem, not an invalid key; check the network or proxy and retry.

**The 5h/week bars do not match the wallet.** That is expected: bars are plan windows; wallet is a separate line. **Check for updates** is under Settings → General, next to the version.

**Updating fails.** Automatic updates download from GitHub Releases and fail on networks that restrict GitHub; download the new version from Releases and install it over the old one, which keeps your data. Unsigned macOS builds do not update automatically. Windows update installers are also unsigned; if SmartScreen appears again, choose More info → Run anyway.

**No model is found, or "Select model" is shown.** Open the model menu at the bottom right of the composer and choose a Tako model. An empty menu means the model directory has not been read yet: confirm that Tako is connected with a valid key, check the network, and restart the app; if it stays empty, check the Tako provider under Settings → Models.

**macOS says the app cannot be opened because the developer cannot be verified.** You downloaded an unsigned build; allow it under Privacy & Security as described in "Unsigned macOS builds".
