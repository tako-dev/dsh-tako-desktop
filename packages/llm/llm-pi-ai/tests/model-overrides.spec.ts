/** Per-model user values are independent of a refreshed explicit provider catalog. */
import { describe, expect, it } from 'vitest'
import { resolveProfiles } from '../src/config.ts'
import type { PiAiModelOverride, PiAiModelProfile } from '../src/config.ts'

const catalog: PiAiModelProfile[] = [
  {
    id: 'alpha', name: 'Alpha', contextWindow: 128_000, maxTokens: 8192,
    input: ['text', 'image'], reasoningEfforts: { off: null, high: 'high' },
    compat: { supportsStore: false, supportsDeveloperRole: true },
  },
  { id: 'beta', contextWindow: 64_000, maxTokens: 4096 },
]

function profile(models = catalog, modelOverrides: Record<string, PiAiModelOverride> = {}, validation: 'strict' | 'deferred' = 'strict') {
  const result = resolveProfiles({
    tako: {
      api: 'openai-completions', baseURL: 'https://fixture.invalid/v1', models, modelOverrides,
    },
  }, validation).get('tako')
  if (result === undefined) throw new Error('No fixture route resolved')
  return result
}

describe('user overrides over an explicit model catalog', () => {
  it('overrides only named fields, retaining sibling models and unedited capabilities', () => {
    const original = structuredClone(catalog)
    const resolved = profile(catalog, {
      alpha: { contextWindow: 256_000, maxTokens: 16_000, compat: { supportsDeveloperRole: false } },
    })
    expect(resolved.piProvider?.getModels()).toMatchObject([
      {
        id: 'alpha', name: 'Alpha', contextWindow: 256_000, maxTokens: 16_000,
        input: ['text', 'image'], reasoning: true,
        compat: { supportsStore: false, supportsDeveloperRole: false },
      },
      { id: 'beta', contextWindow: 64_000, maxTokens: 4096 },
    ])
    expect(resolved.configuredMaxTokens.get('alpha')).toBe(16_000)
    expect(catalog).toEqual(original)
  })

  it('keeps explicit values across catalog refresh and restores the latest upstream field on unset', () => {
    const refreshed = catalog.map(model => ({ ...model, contextWindow: 512_000, maxTokens: 32_000 }))
    const custom = profile(refreshed, { alpha: { contextWindow: 128_000 } })
    expect(custom.piProvider?.getModels()).toMatchObject([
      { id: 'alpha', contextWindow: 128_000, maxTokens: 32_000 },
      { id: 'beta', contextWindow: 512_000, maxTokens: 32_000 },
    ])
    expect(profile(refreshed).piProvider?.getModels()[0]?.contextWindow).toBe(512_000)
  })

  it('does not erase model modalities when the config schema materializes an empty override input', () => {
    expect(profile(catalog, { alpha: { contextWindow: 256_000, input: [] } }).piProvider?.getModels()[0]?.input)
      .toEqual(['text', 'image'])
  })

  it('reports removed model overrides without bringing their model back', () => {
    const remaining = catalog.filter(model => model.id !== 'alpha')
    expect(() => profile(remaining, { alpha: { contextWindow: 256_000 } }))
      .toThrow('modelOverrides names "alpha"')
    const resolved = profile(remaining, { alpha: { contextWindow: 256_000 } }, 'deferred')
    expect(resolved.piProvider?.getModels().map(model => model.id)).toEqual(['beta'])
    expect(resolved.modelErrors.get('alpha')).toContain('modelOverrides names "alpha"')
  })

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.POSITIVE_INFINITY, Number.NaN])(
    'refuses capacity %s in either override field', (value) => {
      for (const field of ['contextWindow', 'maxTokens'] as const) {
        expect(() => profile(catalog, { alpha: { [field]: value } })).toThrow(field)
      }
    },
  )

  it('accepts the exact safe-integer upper limit', () => {
    expect(profile(catalog, { alpha: { contextWindow: Number.MAX_SAFE_INTEGER } })
      .piProvider?.getModels()[0]?.contextWindow).toBe(Number.MAX_SAFE_INTEGER)
  })
})
