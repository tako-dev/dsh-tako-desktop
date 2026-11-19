# Plugin Market Entry Acceptance · 2026-11-16

English | [中文](NOTES.zh.md)

Ticket a9372170 (parent 5c8b788e, tako-dev/dsh-tako-desktop#35). Change: surface the **Custom plugin markets** entry at the top of Tako picks on the Plugins page, fix desktop profile detection and the back path from More, keep it off by default, and trust no arbitrary index.

## What changed

- `packages/client/ui-plugin-manager/src/client/PluginManagerPage.tsx`: `TAKO_CURATED_BUNDLES` gains `@deepseek-ai/dsh-experimental-plugin-market-bundle` (first in Tako picks); `takoProfile` detection moves from `listed` (post card filtering) to `state.packages` (the desktop profile declares `@deepseek-ai/dsh-tako` without installing it, which the old detection missed); `detailFromMore` adds `!curatedNames.has(view.name)`, fixing the wrong jump back to the More list when returning from a Tako-picks detail view.
- `packages/experimental/plugin-market-bundle/README.md` / `README.zh.md`: the entry instructions now read "Tako profile → Tako picks; other profiles → More".

## How it was verified

Launch the app under the Tako profile → open the Plugins page → see **Custom plugin markets** as the first Tako picks entry, off by default → enable the bundle → the **Discover** tab appears → enter Discover → open the index sources dialog (with the third-party trust warning) → add the sample index → entries are listed → open an entry detail → click install → the install confirmation dialog (with permission warnings) → install running. No external index is fetched without user interaction.

## Screenshots

| File | What it proves |
|---|---|
| `03-plugins-list.png` | **Custom plugin markets** is the first entry of the Tako picks group on the Plugins page |
| `04-market-enabled.png` | The bundle is off by default and appears in the enabled area after manual switch-on |
| `05-discover-empty.png` | The **Discover** tab appears after enabling and is empty before adding an index source |
| `06-sources-dialog.png` | The index source management dialog, with the third-party index trust warning copy |
| `07-source-added.png` | The sample index source was added successfully |
| `08-discover-listing.png` | Discover lists the plugin entries of the sample index |
| `09-entry-detail.png` | The entry detail page (name, description, source) |
| `10-install-confirm.png` | The install confirmation dialog, with permission/trust warnings |
| `11-install-running.png` | Install in progress |

## When verified

`2026-11-16 12:47–12:48 CST` (actual screenshot capture time, macOS desktop).

## Not verified / not verifiable

- No separate before screenshots: base `v0.1.49` keeps the market bundle out of `TAKO_CURATED_BUNDLES`, so before the change the card could only be reached from More; this difference is covered by the diff and the new tests.
- Mobile / Windows not verified (real macOS desktop UI only).
- The install-completed state was not verified: screenshots stop at "install checking" and did not wait for the final success/failure state.
