import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { IndexInjection } from '@deepseek-ai/dsh-host-webserver'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { apply, CLIENT_TITLE_GLOBAL, Config, TAKO_PROFILE_GLOBAL } from '../src/index.ts'

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
