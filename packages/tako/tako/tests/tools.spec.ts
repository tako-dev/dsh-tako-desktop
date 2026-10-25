import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { applyTakoTools } from '../src/tools.ts'
import type { TakoToolClient } from '../src/tools.ts'

const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

async function mount(client: TakoToolClient): Promise<{ ctx: Context; call: (name: string, args: unknown) => Promise<ToolExecutionResult> }> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  applyTakoTools(ctx, client)
  let count = 0
  return {
    ctx,
    call: (name, args) => ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId(`tako-${++count}`),
      turn: 7,
      name,
      arguments: args,
    }),
  }
}

describe('Tako model-facing tools', () => {
  it('registers the complete capability set and forwards search correlation', async () => {
    const requestJson = vi.fn(async (_path: string, _body: unknown, _signal: AbortSignal | undefined, correlation: unknown) => {
      expect(correlation).toEqual({ turnId: '7', toolCallId: 'tako-1' })
      return { answer: 'answer', results: [{ title: 'Source', url: 'https://example.test', snippet: 'snippet' }] }
    })
    const client = {
      requestJson,
      transcribe: vi.fn(),
      speech: vi.fn(),
      quota: vi.fn(async () => ({ source: 'user-quota', fetchedAt: '2026-01-01T00:00:00.000Z', usage: { dailyCost: 2 } })),
    } as TakoToolClient
    const { ctx, call } = await mount(client)

    expect(ctx.tools.schemas().map(schema => schema.name)).toEqual(expect.arrayContaining([
      'tako_search', 'tako_image', 'tako_transcribe', 'tako_speech',
      'tako_usage',
    ]))
    const result = await call('tako_search', { query: 'find source', count: 1 })
    expect(result.isError).toBe(false)
    expect(result.value).toEqual({
      answer: 'answer',
      results: [{ title: 'Source', url: 'https://example.test', snippet: 'snippet' }],
    })
    expect(requestJson).toHaveBeenCalledWith('/search', { query: 'find source', count: 1 }, expect.any(AbortSignal), { turnId: '7', toolCallId: 'tako-1' })
  })

  it('uses the media seams and keeps audio output structured', async () => {
    const client = {
      requestJson: vi.fn(async () => ({ data: [{ url: 'https://img.test/a.png' }] })),
      transcribe: vi.fn(async () => ({ text: 'transcribed', language: 'en' })),
      speech: vi.fn(async () => ({ data: 'AQID', format: 'mp3', mimeType: 'audio/mpeg', sizeBytes: 3 })),
      quota: vi.fn(async () => ({ source: 'user-quota', fetchedAt: '2026-01-01T00:00:00.000Z', usage: { dailyCost: 2 } })),
    } as TakoToolClient
    const { call } = await mount(client)

    await expect(call('tako_image', { prompt: 'a cat' })).resolves.toMatchObject({ isError: false, value: { model: 'gpt-image-2' } })
    await expect(call('tako_transcribe', { audioBase64: 'AQID' })).resolves.toMatchObject({ isError: false, value: { text: 'transcribed', language: 'en' } })
    await expect(call('tako_speech', { text: 'hello' })).resolves.toMatchObject({ isError: false, value: { data: 'AQID', sizeBytes: 3 } })
    await expect(call('tako_usage', {})).resolves.toMatchObject({
      isError: false,
      value: { source: 'user-quota', usage: { dailyCost: 2 } },
    })
  })

  it('persists base64 image results through the DSH attachment service for preview', async () => {
    const ref = {
      attachmentId: 'sha256:tako-image', mediaType: 'image/png', bytes: 8, width: 1, height: 1,
      name: 'tako-image.png',
    }
    const saveImage = vi.fn(async () => ref)
    const client = {
      requestJson: vi.fn(async () => ({ data: [{ b64_json: 'iVBORw0KGgo=', mimeType: 'image/png' }] })),
      transcribe: vi.fn(),
      speech: vi.fn(),
      quota: vi.fn(),
    } as TakoToolClient
    const { ctx, call } = await mount(client)
    ctx.provide('attachments', {
      imageLimits: { mediaTypes: ['image/png'] },
      saveImage,
    } as never)

    const result = await call('tako_image', { prompt: 'a cat' })
    expect(result.isError).toBe(false)
    expect(result.value).toMatchObject({ images: [{ attachment: ref }] })
    expect(saveImage).toHaveBeenCalledWith({
      data: Uint8Array.from(Buffer.from('iVBORw0KGgo=', 'base64')),
      mediaType: 'image/png',
      name: 'tako-image.png',
    })
    const rendered = ctx.tools.get('tako_image')?.output.render({}, result.value as never)
    expect(rendered).toEqual([{ type: 'image', attachment: ref }])
  })

  it('persists generated audio as a durable file when the attachment service is available', async () => {
    const ref = { attachmentId: 'sha256:tako-audio', name: 'tako-speech.mp3', bytes: 3 }
    const saveFile = vi.fn(async () => ref)
    const client = {
      requestJson: vi.fn(),
      transcribe: vi.fn(),
      speech: vi.fn(async () => ({ data: 'AQID', format: 'mp3', mimeType: 'audio/mpeg', sizeBytes: 3 })),
      quota: vi.fn(),
    } as TakoToolClient
    const { ctx, call } = await mount(client)
    ctx.provide('attachments', { saveFile } as never)

    const result = await call('tako_speech', { text: 'hello' })
    expect(result.isError).toBe(false)
    expect(result.value).toMatchObject({ attachment: ref, format: 'mp3', sizeBytes: 3 })
    expect(result.value).not.toHaveProperty('data')
    expect(saveFile).toHaveBeenCalledWith({
      data: Uint8Array.from(Buffer.from('AQID', 'base64')),
      name: 'tako-speech.mp3',
    })
    expect(ctx.tools.get('tako_speech')?.output.render({}, result.value as never)).toEqual([
      { type: 'file', attachment: ref },
    ])
  })
})
