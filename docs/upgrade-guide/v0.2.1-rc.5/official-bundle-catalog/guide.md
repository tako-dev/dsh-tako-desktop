---
kind: upgrade-guide
description: "Profile templates and bundle catalog exports move from @deepseek-ai/dsh-app-boot to @deepseek-ai/dsh-official-bundles."
---

# Import profile templates and bundle lists from their owning package

English | [中文](guide.zh.md)

## Change

`@deepseek-ai/dsh-app-boot` no longer exports `PROFILE_TEMPLATES`, `ProfileTemplate`, `DEFAULT_PROFILE_BUNDLES`, `OPTIONAL_BUNDLES`, `ON_DEMAND_BUNDLES`, `OFFICIAL_ON_DEMAND_CATALOG`, `OfficialBundleCatalogEntry`, or the Tako-specific `TAKO_DEFAULT_BUNDLES`. These exports belong to `@deepseek-ai/dsh-official-bundles`; imports from app-boot fail to compile or load. Profile names, bundle order, optional selections, and offline metadata remain unchanged. This relocation does not upgrade the installed kernel or select a release channel.

## Migration

1. Add `@deepseek-ai/dsh-official-bundles` to the dependencies of packages using these exports. Repository workspaces use `workspace:*`; external consumers use the version matching their DSH installation.
2. Import the listed names from `@deepseek-ai/dsh-official-bundles`. Keep boot, profile loading, and filesystem operations imported from `@deepseek-ai/dsh-app-boot`.
3. Rebuild the consumer and verify its profile selection. Tako consumers retain the bundled `@deepseek-ai/dsh-tako` immediately after `@deepseek-ai/dsh-web-app`; do not remove it or pin npm `dsh-tako` while changing imports. Existing profile files and user model choices need no edits.
