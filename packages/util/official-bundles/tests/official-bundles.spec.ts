/** Installation-owned bundle selections retain the Tako fork's existing product defaults. */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PROFILE_BUNDLES, INSTALLATION_OWNED_PROFILE_TUPLES, OFFICIAL_ON_DEMAND_CATALOG, ON_DEMAND_BUNDLES,
  OPTIONAL_BUNDLES, PROFILE_TEMPLATES, PROTECTED_PLUGINS, RETIRED_BUNDLES, TAKO_DEFAULT_BUNDLES,
} from '../src/index.ts'

const root = resolve(import.meta.dirname, '../../../..')

describe('shipped profile templates', () => {
  it('retains every profile and the bundled Tako provider before its companion bundles', () => {
    expect(PROFILE_TEMPLATES).toEqual({
      acp: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-acp-app'] },
      web: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] },
      tako: { bundles: [
        '@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh-tako',
        '@deepseek-ai/dsh-experimental-tako-browser-bundle', '@deepseek-ai/dsh-experimental-session-search',
        '@deepseek-ai/dsh-experimental-session-titles-bundle', '@deepseek-ai/dsh-experimental-terminal-bundle',
        '@deepseek-ai/dsh-experimental-voice-input-bundle',
      ] },
      headless: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless'] },
      sdk: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-sdk-app'] },
      'sdk-minimal': { bundles: ['@deepseek-ai/dsh-sdk-minimal'] },
    })
    expect(TAKO_DEFAULT_BUNDLES).toEqual(PROFILE_TEMPLATES.tako?.bundles.slice(3))
    expect(DEFAULT_PROFILE_BUNDLES).toEqual(['@deepseek-ai/dsh-base'])
    expect(INSTALLATION_OWNED_PROFILE_TUPLES).toEqual({
      headless: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh-headless'],
    })
    expect([...RETIRED_BUNDLES]).toEqual(['@deepseek-ai/dsh-experimental-schedule-bundle'])
  })

  it('keeps the existing optional roster without enabling new upstream capabilities', () => {
    expect(OPTIONAL_BUNDLES).toEqual([
      '@deepseek-ai/dsh-experimental-session-search',
      '@deepseek-ai/dsh-experimental-ralph-bundle',
      '@deepseek-ai/dsh-experimental-terminal-bundle',
      '@deepseek-ai/dsh-experimental-badge-skill-bundle',
      '@deepseek-ai/dsh-experimental-session-titles-bundle',
      '@deepseek-ai/dsh-experimental-agent-team-profile',
      '@deepseek-ai/dsh-experimental-voice-input-bundle',
      '@deepseek-ai/dsh-experimental-cot-translation-bundle',
      '@deepseek-ai/dsh-experimental-auto-review',
      '@deepseek-ai/dsh-experimental-inspector-profile',
      '@deepseek-ai/dsh-experimental-plugin-market-bundle',
      '@deepseek-ai/dsh-experimental-tool-worktree',
      '@deepseek-ai/dsh-experimental-tako-browser-bundle',
    ])
    expect(new Set(OPTIONAL_BUNDLES).size).toBe(OPTIONAL_BUNDLES.length)
    const cli = JSON.parse(readFileSync(resolve(root, 'apps/cli/package.json'), 'utf8')) as {
      dependencies: Record<string, string>
    }
    for (const name of [...OPTIONAL_BUNDLES, ...Object.values(PROFILE_TEMPLATES).flatMap(profile => profile.bundles)]) {
      expect(cli.dependencies[name], name).toBe('workspace:*')
    }
    expect(PROFILE_TEMPLATES.tako?.bundles).not.toContain('@deepseek-ai/dsh-experimental-plugin-market-bundle')
  })
})

describe('offline on-demand catalog', () => {
  it('offers the existing native subagents with both locales and no provider import or version pin', () => {
    expect(ON_DEMAND_BUNDLES).toEqual(['@deepseek-ai/dsh-subagent-claude-code', '@deepseek-ai/dsh-subagent-codex'])
    expect(OFFICIAL_ON_DEMAND_CATALOG.map(entry => entry.packageName)).toEqual(ON_DEMAND_BUNDLES)
    for (const entry of OFFICIAL_ON_DEMAND_CATALOG) {
      expect(entry.meta.icon).toMatch(/^data:image\/svg\+xml;base64,/)
      for (const text of [entry.meta.title, entry.meta.description]) {
        if (typeof text === 'string') throw new Error('Official metadata requires both shipped languages')
        expect(text.en).toMatch(/\S/)
        expect(text.zh).toMatch(/\S/)
      }
      expect(entry).not.toHaveProperty('version')
    }
  })
})

describe('protected plugin packages', () => {
  it('retains the two Tako provider names and the plugin manager dependencies', () => {
    expect([...PROTECTED_PLUGINS]).toEqual([
      '@deepseek-ai/dsh-tako', 'dsh-tako',
      '@deepseek-ai/dsh-plugin-manager', '@deepseek-ai/cordis-plugin-loader',
      '@deepseek-ai/cordis-plugin-include', '@deepseek-ai/dsh-api-gateway',
      '@deepseek-ai/dsh-host-webserver', '@deepseek-ai/dsh-client-modules',
      '@deepseek-ai/dsh-client-ui-settings-plugin-inventory', '@deepseek-ai/dsh-client-ui-plugin-manager',
      '@deepseek-ai/dsh-host-plugin-inventory', '@deepseek-ai/dsh-typert-registry',
      '@deepseek-ai/dsh-api-remotes', '@deepseek-ai/dsh-api-remote-access',
      '@deepseek-ai/cordis-plugin-timer', '@deepseek-ai/dsh-client-connection',
      '@deepseek-ai/dsh-host-frontend-static', '@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-hmr',
    ])
  })
})
