/**
 * Installation-owned profile selections, offline bundle metadata, and protected plugin names.
 * Profile loading and management operations remain with their consumers.
 * @module @deepseek-ai/dsh-official-bundles
 */

import type { PluginLocalizedMeta } from '@deepseek-ai/dsh-package-manifest'

export {
  DEFAULT_PROFILE_BUNDLES, INSTALLATION_OWNED_PROFILE_TUPLES, ON_DEMAND_BUNDLES, OPTIONAL_BUNDLES,
  PROFILE_TEMPLATES, RETIRED_BUNDLES, TAKO_DEFAULT_BUNDLES, type ProfileTemplate,
} from './bundles.ts'
export { PROTECTED_PLUGINS } from './plugin-manager.ts'

/** Offline discovery metadata; installation state and the requested version belong to the running host. */
export interface OfficialBundleCatalogEntry {
  /** Exact npm package name accepted by the existing bundle installer. */
  readonly packageName: string
  /** Package-owned localized text and a self-contained icon, embedded without provider code. */
  readonly meta: Required<Pick<PluginLocalizedMeta, 'title' | 'description' | 'icon'>>
}

export { OFFICIAL_ON_DEMAND_CATALOG } from './catalog.generated.ts'
