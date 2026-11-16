---
description: "Read installation-owned profile templates, optional bundle selections, offline metadata, and protected plugin names without starting the application."
kind: "package-library"
---

# @deepseek-ai/dsh-official-bundles

English | [中文](README.zh.md)

## Summary

Use this package to select a shipped profile, inspect the installation's optional and on-demand bundles, or identify protected plugin packages without loading providers. App boot, the CLI, Desktop, the plugin manager, and the browser-image packer consume the same selections. The Tako template retains its bundled provider and companion bundles. These exports supply data only; consumers own loading, installation, and refusal behavior.

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

Import profile and bundle selections from this package root. Import profile loading and filesystem operations from [app-boot](../../boot/app-boot/README.md), and package operations from [plugin-manager](../../boot/plugin-manager/README.md). This library is a dependency, not a profile layer.

`PROFILE_TEMPLATES.tako` places `@deepseek-ai/dsh-tako` immediately after `@deepseek-ai/dsh-web-app`, followed by `TAKO_DEFAULT_BUNDLES`. Other templates keep their base-plus-mode stacks; `sdk-minimal` remains standalone. `OPTIONAL_BUNDLES` records the existing installation-supplied choices, including the Tako companions; it does not select them in other profiles. The plugin-market bundle stays outside the Tako defaults.

`PROTECTED_PLUGINS` includes the management dependencies and both `@deepseek-ai/dsh-tako` and `dsh-tako`. The plugin manager refuses to disable their rows or containing bundles, and refuses removal before invoking pnpm. Changing this list does not authorize installing another provider or modifying credentials.

`OFFICIAL_ON_DEMAND_CATALOG` contains package-owned English and Chinese metadata and icons, without importing providers or pinning install targets. Run `pnpm gen-official-bundle-catalog` after changing its source resources; `pnpm verify-official-bundle-catalog` checks freshness. The plugin manager derives installation targets from the running DSH installation.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Repository checks inspect profile and optional selections as TypeScript literals in [`src/bundles.ts`](src/bundles.ts). Keep those declarations inspectable without executing code. `TAKO_DEFAULT_BUNDLES` derives from the Tako template so the companion order has one owner. [`src/plugin-manager.ts`](src/plugin-manager.ts) owns protected package names; [`src/catalog.generated.ts`](src/catalog.generated.ts) is generated from the on-demand packages' resources.

The profile loader applies exact installation-owned tuple migrations and the retired list. The lists do not write a profile, alter model settings, or change release channels.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [App boot profiles](../../boot/app-boot/README.md#profiles) — profile loading and composition.
- [Plugin manager](../../boot/plugin-manager/README.md) — activation and installation operations.
- [Tako maintainer guide](../../../docs/tako/maintainers.md) — bundled-provider invariants.

<a id="model-experience"></a>
## Model Experience

### Profile composition

#### What the model sees

The library adds no model input; plugins selected through `PROFILE_TEMPLATES` own their tools and prompts.

#### Token effect

Reading the exported data consumes no model tokens.

#### KV Cache effect

The library makes no provider request; selected plugins own changes to model-visible declarations.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Selections are compiled into the installation; profile files cannot extend the optional or on-demand catalog.
- Consumers enforce protected names and load selected packages; importing a list does neither operation.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
