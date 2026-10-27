import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { IndexInjection } from '@deepseek-ai/dsh-host-webserver'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { apply, CLIENT_TITLE_GLOBAL, Config, pluginOwnsTakoRoute, TAKO_PROFILE_GLOBAL } from '../src/index.ts'

class OccupyingAdapter extends LlmAdapter {
  async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    throw new Error('not exercised')
  }
}

const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  vi.unstubAllGlobals()
})

describe('Tako provider catalog guard', () => {
  it('blocks models outside the last known catalog', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })))
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LlmRuntime)
    ctx.provide('credentials', { resolve: async () => ({ value: 'test-key' }) } as never)
    apply(ctx, Config({ baseURL: 'https://tako.example', models: [{ id: 'known-model' }] }))

    await expect(ctx.llm.resolveModelInfo('tako', 'unknown-model')).rejects.toMatchObject({ code: 'UNKNOWN_MODEL' })
    await expect(ctx.llm.resolveModelInfo('tako', 'known-model')).resolves.toMatchObject({ id: 'known-model' })
  })
})

describe('Tako page bootstrap', () => {
  it('marks the Tako profile and retitles the Web client as DSH Tako', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LlmRuntime)
    ctx.provide('credentials', { resolve: async () => ({ value: 'test-key' }) } as never)
    apply(ctx, Config({ baseURL: 'https://tako.example', models: [{ id: 'known-model' }] }))
    const table: IndexInjection[] = []
    ctx.emit('webserver/index-inject', table)
    expect(table).toEqual(expect.arrayContaining([
      { kind: 'global', name: TAKO_PROFILE_GLOBAL, value: true },
      { kind: 'global', name: CLIENT_TITLE_GLOBAL, value: 'DSH Tako' },
    ]))
  })
})

describe('pluginOwnsTakoRoute', () => {
  it.each([
    ['missing settings', undefined, false],
    ['empty namespaces', [], false],
    ['openai-only route', [{ ns: 'llm-pi-ai', value: { providers: { openai: { apiKeyEnv: 'OPENAI_API_KEY' } } } }], false],
    ['value.providers.tako', [{ ns: 'llm-pi-ai', value: { providers: { tako: { apiKeyEnv: 'TAKO_API_KEY' } } } }], true],
    ['user.providers.tako', [{ ns: 'llm-pi-ai', user: { providers: { tako: { apiKeyEnv: 'TAKO_API_KEY' } } } }], true],
  ] as const)('%s', async (_name, namespaces, owned) => {
    const ctx = new Context()
    contexts.push(ctx)
    if (namespaces !== undefined) {
      ctx.provide('settings', { describe: () => namespaces, configure: () => undefined })
    }
    expect(pluginOwnsTakoRoute(ctx)).toBe(owned)
  })
})

describe('Tako chat route yield', () => {
  async function mount(options: {
    settings?: unknown
    occupy?: boolean
  } = {}): Promise<Context> {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })))
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LlmRuntime)
    ctx.provide('credentials', { resolve: async () => ({ value: 'test-key' }) } as never)
    if (options.settings !== undefined) {
      ctx.provide('settings', { describe: () => options.settings, configure: () => undefined })
    }
    if (options.occupy === true) ctx.llm.registerAdapter(['tako'], new OccupyingAdapter())
    apply(ctx, Config({ baseURL: 'https://tako.example', models: [{ id: 'known-model' }] }))
    return ctx
  }

  function globalsOf(ctx: Context): IndexInjection[] {
    const table: IndexInjection[] = []
    ctx.emit('webserver/index-inject', table)
    return table
  }

  it('does not claim provider id tako when the npm plugin route is already present', async () => {
    const ctx = await mount({
      settings: [{ ns: 'llm-pi-ai', value: { providers: { tako: { apiKeyEnv: 'TAKO_API_KEY', models: [{ id: 'from-plugin' }] } } } }],
    })
    expect(ctx.llm.listProviders().map(provider => provider.id)).not.toContain('tako')
    expect(ctx.llm.listConfigurableProviders().some(entry => entry.settingsNs === 'llm-tako')).toBe(false)
    expect(ctx.takoClient).toBeDefined()
    expect(globalsOf(ctx)).toEqual(expect.arrayContaining([
      { kind: 'global', name: TAKO_PROFILE_GLOBAL, value: true },
      { kind: 'global', name: CLIENT_TITLE_GLOBAL, value: 'DSH Tako' },
    ]))
  })

  it('keeps tools and credentials when another adapter already owns tako', async () => {
    const ctx = await mount({ occupy: true })
    expect(ctx.llm.listProviders()).toEqual([{ id: 'tako', name: 'tako' }])
    expect(ctx.takoClient).toBeDefined()
    expect(globalsOf(ctx)).toEqual(expect.arrayContaining([
      { kind: 'global', name: TAKO_PROFILE_GLOBAL, value: true },
    ]))
  })
})
