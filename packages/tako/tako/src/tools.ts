/** Model-facing Tako capability tools. @module @deepseek-ai/dsh-tako/tools */

import type { Context } from '@deepseek-ai/cordis'
import type { FileAttachmentRef, ImageAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, ToolCallKind, ToolResult } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { TakoAudioResponse, TakoCorrelation, TakoImageResponse, TakoQuotaSnapshot, TakoReceipt, TakoSearchResponse, TakoTranscriptionResponse } from './api.ts'

/** Tool registration options. */
export interface TakoToolConfig {
  /** Enable the search tool. Defaults to true. */
  search?: boolean
  /** Enable the image tool. Defaults to true. */
  image?: boolean
  /** Enable the transcription tool. Defaults to true. */
  transcribe?: boolean
  /** Enable the speech-generation tool. Defaults to true. */
  speech?: boolean
  /** Enable the read-only quota tool. Defaults to true. */
  usage?: boolean
  /** Cooperative timeout for each billed request. */
  timeoutMs?: number
}

/** Correlation headers shared by all Tako tool requests. */
function correlation(exec: ToolRunContext) {
  return {
    ...exec.agent === undefined ? {} : { sessionId: String(exec.agent.session.id) },
    ...exec.turn === undefined ? {} : { turnId: String(exec.turn) },
    toolCallId: String(exec.callId),
  }
}

function requireText(value: string, field: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) throw new Error(`${field} must be a non-empty string`)
  return trimmed
}

function formatSearch(result: TakoSearchResponse): string {
  const lines: string[] = []
  if (result.answer !== undefined && result.answer.length > 0) lines.push(result.answer)
  for (const source of result.results ?? []) {
    const label = source.title ?? source.url
    const suffix = source.snippet === undefined ? '' : ` — ${source.snippet}`
    lines.push(`- [${label}](${source.url})${suffix}`)
  }
  return lines.length === 0 ? 'No results found.' : lines.join('\n\n')
}

function receiptSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      correlationId: { type: 'string', required: true },
      status: { type: 'string', required: true },
      requestId: { type: 'string' },
      createdAt: { type: 'number' },
      model: { type: 'string' },
      usage: {
        type: 'object',
        additionalProperties: false,
        properties: {
          cost: { type: 'number' },
          promptTokens: { type: 'integer' },
          completionTokens: { type: 'integer' },
        },
      },
    },
  } as const
}

function formatReceipt(receipt: TakoReceipt | undefined): string {
  if (receipt === undefined || receipt.correlationId === '') return ''
  if (receipt.status === 'pending') return `Usage receipt pending (${receipt.correlationId}).`
  if (receipt.status === 'unavailable') return `Usage receipt unavailable (${receipt.correlationId}).`
  const cost = receipt.usage?.cost === undefined ? '' : ` Cost: ${receipt.usage.cost}.`
  return `Usage settled (${receipt.correlationId}).${cost}`
}

async function receiptFor(client: TakoToolClient, correlation: TakoCorrelation, signal: AbortSignal): Promise<TakoReceipt | undefined> {
  // Older test doubles and host adapters may not expose the optional receipt
  // endpoint yet; the primary billed operation remains successful in that case.
  if (typeof client.receipt !== 'function') {
    return undefined
  }
  return client.receipt(correlation, signal)
}

/** Detect the raster type before handing provider bytes to the attachment validator. */
function imageMediaType(bytes: Uint8Array): ImageMediaType | undefined {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'image/png'
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg'
  if (bytes.length >= 4 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return 'image/gif'
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp'
  return undefined
}

/** Save provider-returned base64 images through DSH's durable attachment service when mounted. */
async function attachImage(ctx: Context, image: { b64_json?: string; mimeType?: string }): Promise<ImageAttachmentRef | undefined> {
  if (image.b64_json === undefined) return undefined
  const attachments = ctx.get('attachments')
  if (attachments === undefined) return undefined
  // Bound the decode before allocating bytes from an untrusted provider response.
  if (image.b64_json.length > Math.ceil(attachments.imageLimits.maxImageBytes * 4 / 3) + 16) return undefined
  const bytes = Uint8Array.from(Buffer.from(image.b64_json, 'base64'))
  const mediaType = imageMediaType(bytes)
  if (mediaType === undefined || !attachments.imageLimits.mediaTypes.includes(mediaType)
    || (image.mimeType !== undefined && image.mimeType.split(';', 1)[0] !== mediaType)) return undefined
  try {
    return await attachments.saveImage({ data: bytes, mediaType, name: `tako-image.${mediaType.slice('image/'.length)}` })
  } catch {
    // A malformed provider payload must remain a normal tool result; it must not
    // turn a successful API response into a broken session append.
    return undefined
  }
}

function imageContent(value: { images?: Array<{ url?: string; b64_json?: string; revised_prompt?: string; attachment?: ImageAttachmentRef }> }): ContentBlock[] {
  const blocks: ContentBlock[] = []
  for (const [index, image] of (value.images ?? []).entries()) {
    if (image.attachment !== undefined) {
      blocks.push({ type: 'image', attachment: image.attachment })
    } else if (image.url !== undefined) {
      blocks.push({ type: 'text', text: `Image ${index + 1}: ${image.url}` })
    } else if (image.b64_json !== undefined) {
      blocks.push({ type: 'text', text: `Image ${index + 1}: base64 image data returned.` })
    } else {
      blocks.push({ type: 'text', text: `Image ${index + 1}: unavailable.` })
    }
  }
  return blocks.length === 0 ? [{ type: 'text', text: 'Tako returned no image data.' }] : blocks
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isImageAttachment(value: unknown): value is ImageAttachmentRef {
  if (!isRecord(value)) return false
  return typeof value.attachmentId === 'string'
    && typeof value.mediaType === 'string'
    && ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(value.mediaType)
    && typeof value.bytes === 'number'
    && typeof value.width === 'number'
    && typeof value.height === 'number'
}

function isFileAttachment(value: unknown): value is FileAttachmentRef {
  return isRecord(value)
    && typeof value.attachmentId === 'string'
    && typeof value.name === 'string'
    && typeof value.bytes === 'number'
}

function isReceipt(value: unknown): value is TakoReceipt {
  return isRecord(value)
    && typeof value.correlationId === 'string'
    && (value.status === 'pending' || value.status === 'unavailable' || value.status === 'settled')
}

function renderImageResult(value: unknown): ContentBlock[] {
  const source = isRecord(value) && Array.isArray(value.images) ? value.images : []
  const images = source.filter(isRecord).map(image => ({
    ...typeof image.url === 'string' ? { url: image.url } : {},
    ...typeof image.b64_json === 'string' ? { b64_json: image.b64_json } : {},
    ...typeof image.revised_prompt === 'string' ? { revised_prompt: image.revised_prompt } : {},
    ...isImageAttachment(image.attachment) ? { attachment: image.attachment } : {},
  }))
  return imageContent({ images })
}

function renderSpeechResult(value: unknown): ContentBlock[] {
  const result = isRecord(value) ? value : {}
  const format = typeof result.format === 'string' ? result.format : 'audio'
  const sizeBytes = typeof result.sizeBytes === 'number' ? result.sizeBytes : 0
  const blocks = isFileAttachment(result.attachment)
    ? [{ type: 'file' as const, attachment: result.attachment }]
    : [{ type: 'text' as const, text: formatAudio('Tako speech generated.', format, sizeBytes) }]
  const receiptText = formatReceipt(isReceipt(result.receipt) ? result.receipt : undefined)
  return receiptText === '' ? blocks : [...blocks, { type: 'text' as const, text: receiptText }]
}

function formatAudio(text: string, format: string, sizeBytes: number): string {
  return `${text} Generated ${format} audio (${sizeBytes} bytes).`
}

/** Persist generated audio as a generic DSH file so the current turn can open it after restart. */
async function attachAudio(ctx: Context, audio: { data: string; format: string }): Promise<FileAttachmentRef | undefined> {
  const attachments = ctx.get('attachments')
  if (attachments === undefined || typeof attachments.saveFile !== 'function') return undefined
  try {
    const bytes = Uint8Array.from(Buffer.from(audio.data, 'base64'))
    return await attachments.saveFile({ data: bytes, name: `tako-speech.${audio.format}` })
  } catch {
    // Audio storage is an enhancement; the provider result remains available as base64.
    return undefined
  }
}

function formatQuota(result: TakoQuotaSnapshot): string {
  const lines = ['Tako quota snapshot (read-only).']
  if (result.usage?.windowCost !== undefined) lines.push(`Window usage: ${result.usage.windowCost}${result.plan?.windowCostLimit == null ? '' : ` / ${result.plan.windowCostLimit}`}`)
  if (result.usage?.dailyCost !== undefined) lines.push(`Daily usage: ${result.usage.dailyCost}${result.plan?.dailyCostLimit == null ? '' : ` / ${result.plan.dailyCostLimit}`}`)
  if (result.usage?.weeklyCost !== undefined) lines.push(`Weekly usage: ${result.usage.weeklyCost}${result.plan?.weeklyCostLimit == null ? '' : ` / ${result.plan.weeklyCostLimit}`}`)
  if (result.plan?.windowMinutes !== undefined && result.plan.windowMinutes !== null) lines.push(`Window: ${result.plan.windowMinutes} minutes`)
  lines.push(`Source: ${result.source}; fetched at ${result.fetchedAt}`)
  return lines.join('\n')
}

/** Generic pending card for a billed Tako request. */
function present(kind: ToolCallKind, title: string): GenericCallView {
  return { card: 'generic', title, kind, rawInput: title }
}

/** Narrow transport consumed by model-facing tools; the full client also owns model discovery. */
export interface TakoToolClient {
  /** @param path - API path. @param body - JSON body. @param signal - cancellation. @param correlation - DSH identity. @returns decoded response. */
  requestJson<T>(path: string, body: unknown | undefined, signal: AbortSignal | undefined, correlation: TakoCorrelation): Promise<T>
  /** @param input - audio request. @param signal - cancellation. @param correlation - DSH identity. @returns transcription. */
  transcribe(input: { audioBase64: string; filename: string; mimeType: string; model?: string; language?: string }, signal: AbortSignal | undefined, correlation: TakoCorrelation): Promise<TakoTranscriptionResponse>
  /** @param input - speech request. @param signal - cancellation. @param correlation - DSH identity. @returns audio response. */
  speech(input: { model: string; text: string; voice: string; format: string }, signal: AbortSignal | undefined, correlation: TakoCorrelation): Promise<TakoAudioResponse>
  /** @param signal - cancellation. @param correlation - DSH identity. @returns read-only quota. */
  quota(signal?: AbortSignal, correlation?: TakoCorrelation): Promise<TakoQuotaSnapshot>
  /** @param correlation - DSH identity. @param signal - cancellation. @returns optional ledger receipt. */
  receipt?(correlation: TakoCorrelation, signal?: AbortSignal): Promise<TakoReceipt>
}

/** Register the Tako capability tools against one authenticated client.
 * @param ctx - DSH context supplying tools and system prompts.
 * @param client - Authenticated Tako transport.
 * @param config - Enabled capabilities and timeout settings.
 */
export function applyTakoTools(ctx: Context, client: TakoToolClient, config: TakoToolConfig = {}): void {
  const timeoutMs = config.timeoutMs ?? 120_000
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('tako: timeoutMs must be positive')

  ctx.systemPrompt.section({
    name: 'tool:tako',
    order: 111,
    text: 'Use Tako tools for billed web search, image generation, speech transcription, and speech generation. Search results include URLs to cite. Report when a capability fails or consumes the account quota.',
  })

  if (config.search !== false) {
    ctx.tools.register(defineTool({
      name: 'tako_search',
      description: 'Search the web through Tako. Returns a summary and source URLs that must be cited in the answer.',
      parameters: {
        query: { type: 'string', required: true, description: 'A focused web search query.' },
        count: { type: 'integer', description: 'Maximum number of sources, from 1 to 20.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            answer: { type: 'string' },
            provider: { type: 'string' },
            results: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  title: { type: 'string' },
                  url: { type: 'string', required: true },
                  snippet: { type: 'string' },
                  publishedAt: { type: 'string' },
                },
              },
            },
            receipt: receiptSchema(),
          },
        },
        render: (_args, value) => {
          const result = value as TakoSearchResponse & { receipt?: TakoReceipt }
          return [{ type: 'text', text: `${formatSearch(result)}\n\n${formatReceipt(result.receipt)}`.trim() }]
        },
      },
      timeoutMs,
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const requestCorrelation = correlation(exec)
        const query = requireText(args.query, 'query')
        const count = args.count === undefined ? 5 : Math.max(1, Math.min(20, Math.trunc(args.count)))
        const result = await client.requestJson<TakoSearchResponse>('/search', { query, count }, exec.signal, requestCorrelation)
        const receipt = await receiptFor(client, requestCorrelation, exec.signal)
        return {
          ...result.answer === undefined ? {} : { answer: result.answer },
          ...result.provider === undefined ? {} : { provider: result.provider },
          results: (result.results ?? []).slice(0, count).map(source => ({
            ...source.title === undefined ? {} : { title: source.title },
            url: source.url,
            ...source.snippet === undefined ? {} : { snippet: source.snippet },
            ...source.publishedAt === undefined ? {} : { publishedAt: source.publishedAt },
          })),
          ...receipt === undefined ? {} : { receipt },
        }
      },
      presentCall: args => present('search', args.query),
    }))
  }

  if (config.image !== false) {
    ctx.tools.register(defineTool({
      name: 'tako_image',
      description: 'Generate an image through Tako and return a preview URL or image payload metadata.',
      parameters: {
        prompt: { type: 'string', required: true, description: 'Detailed image prompt.' },
        model: { type: 'string', description: 'Tako image model; defaults to gpt-image-2.' },
        size: { type: 'string', description: 'Image size, for example 1024x1024.' },
        n: { type: 'integer', description: 'Number of images, currently 1 is safest.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            model: { type: 'string', required: true },
            images: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  url: { type: 'string' },
                  b64_json: { type: 'string' },
                  mimeType: { type: 'string' },
                  revised_prompt: { type: 'string' },
                  attachment: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      attachmentId: { type: 'string', required: true },
                      mediaType: { type: 'string', required: true },
                      bytes: { type: 'integer', required: true },
                      width: { type: 'integer', required: true },
                      height: { type: 'integer', required: true },
                      name: { type: 'string' },
                    },
                  },
                },
              },
            },
            receipt: receiptSchema(),
          },
        },
        render: (_args, value) => {
          const receipt = isRecord(value) ? value.receipt : undefined
          const text = formatReceipt(isReceipt(receipt) ? receipt : undefined)
          const blocks = renderImageResult(value)
          return text === '' ? blocks : [...blocks, { type: 'text' as const, text }]
        },
      },
      timeoutMs,
      async execute(args, exec) {
        const requestCorrelation = correlation(exec)
        const prompt = requireText(args.prompt, 'prompt')
        const model = args.model === undefined ? 'gpt-image-2' : requireText(args.model, 'model')
        const n = args.n === undefined ? 1 : Math.max(1, Math.min(4, Math.trunc(args.n)))
        const result = await client.requestJson<TakoImageResponse>('/images/generations', {
          model,
          prompt,
          n,
          ...args.size === undefined ? {} : { size: args.size },
        }, exec.signal, requestCorrelation)
        const receipt = await receiptFor(client, requestCorrelation, exec.signal)
        const images = []
        for (const image of result.data ?? []) {
          const attachment = await attachImage(ctx, image)
          images.push({
            ...image.url === undefined ? {} : { url: image.url },
            ...image.b64_json === undefined ? {} : { b64_json: image.b64_json },
            ...image.mimeType === undefined ? {} : { mimeType: image.mimeType },
            ...image.revised_prompt === undefined ? {} : { revised_prompt: image.revised_prompt },
            ...attachment === undefined ? {} : { attachment },
          })
        }
        return {
          model,
          images,
          ...receipt === undefined ? {} : { receipt },
        }
      },
      presentCall: args => present('other', args.prompt),
    }))
  }

  if (config.transcribe !== false) {
    ctx.tools.register(defineTool({
      name: 'tako_transcribe',
      description: 'Transcribe a base64-encoded audio file through Tako speech recognition.',
      parameters: {
        audioBase64: { type: 'string', required: true, description: 'Base64-encoded audio bytes.' },
        filename: { type: 'string', description: 'Original filename, default audio.bin.' },
        mimeType: { type: 'string', description: 'Audio MIME type, default audio/wav.' },
        model: { type: 'string', description: 'ASR model, when required by the account.' },
        language: { type: 'string', description: 'Optional ISO language code.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            text: { type: 'string', required: true },
            language: { type: 'string' },
            duration: { type: 'number' },
            receipt: receiptSchema(),
          },
        },
        render: (_args, value) => {
          const result = value as { text: string; receipt?: TakoReceipt }
          return [{ type: 'text', text: `${result.text}\n\n${formatReceipt(result.receipt)}`.trim() }]
        },
      },
      timeoutMs,
      async execute(args, exec) {
        const requestCorrelation = correlation(exec)
        const audioBase64 = requireText(args.audioBase64, 'audioBase64')
        const result = await client.transcribe({
          audioBase64,
          filename: args.filename === undefined ? 'audio.bin' : requireText(args.filename, 'filename'),
          mimeType: args.mimeType === undefined ? 'audio/wav' : requireText(args.mimeType, 'mimeType'),
          ...args.model === undefined ? {} : { model: requireText(args.model, 'model') },
          ...args.language === undefined ? {} : { language: requireText(args.language, 'language') },
        }, exec.signal, requestCorrelation)
        const receipt = await receiptFor(client, requestCorrelation, exec.signal)
        return {
          text: result.text,
          ...result.language === undefined ? {} : { language: result.language },
          ...result.duration === undefined ? {} : { duration: result.duration },
          ...receipt === undefined ? {} : { receipt },
        }
      },
      presentCall: () => present('other', 'Transcribe audio'),
    }))
  }

  if (config.speech !== false) {
    ctx.tools.register(defineTool({
      name: 'tako_speech',
      description: 'Generate speech audio through Tako and return a base64 audio artifact payload.',
      parameters: {
        text: { type: 'string', required: true, description: 'Text to speak.' },
        model: { type: 'string', description: 'TTS model.' },
        voice: { type: 'string', description: 'Voice name.' },
        format: { type: 'string', description: 'Output format, default mp3.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            data: { type: 'string' },
            format: { type: 'string', required: true },
            mimeType: { type: 'string', required: true },
            sizeBytes: { type: 'integer', required: true },
            receipt: receiptSchema(),
            attachment: {
              type: 'object',
              additionalProperties: false,
              properties: {
                attachmentId: { type: 'string', required: true },
                name: { type: 'string', required: true },
                bytes: { type: 'integer', required: true },
              },
            },
          },
        },
        render: (_args, value) => {
          return renderSpeechResult(value)
        },
      },
      timeoutMs,
      async execute(args, exec) {
        const requestCorrelation = correlation(exec)
        const result = await client.speech({
          model: args.model === undefined ? 'gpt-4o-mini-tts' : requireText(args.model, 'model'),
          text: requireText(args.text, 'text'),
          voice: args.voice === undefined ? 'alloy' : requireText(args.voice, 'voice'),
          format: args.format === undefined ? 'mp3' : requireText(args.format, 'format'),
        }, exec.signal, requestCorrelation)
        const receipt = await receiptFor(client, requestCorrelation, exec.signal)
        const attachment = await attachAudio(ctx, result)
        return {
          ...attachment === undefined ? { data: result.data } : { attachment },
          format: result.format,
          mimeType: result.mimeType,
          sizeBytes: result.sizeBytes,
          ...receipt === undefined ? {} : { receipt },
        }
      },
      presentCall: args => present('other', `Speak: ${args.text}`),
    }))
  }

  if (config.usage !== false) {
    ctx.tools.register(defineTool({
      name: 'tako_usage',
      description: 'Read the current Tako API-key quota without making a billed request.',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            apiId: { type: 'string' },
            source: { type: 'string', required: true },
            fetchedAt: { type: 'string', required: true },
            plan: { type: 'object', additionalProperties: true },
            usage: { type: 'object', additionalProperties: true },
            receipt: receiptSchema(),
          },
        },
        render: (_args, value) => {
          const result = value as TakoQuotaSnapshot & { receipt?: TakoReceipt }
          return [{ type: 'text', text: `${formatQuota(result)}\n\n${formatReceipt(result.receipt)}`.trim() }]
        },
      },
      timeoutMs,
      isConcurrencySafe: () => true,
      async execute(_args, exec) {
        const requestCorrelation = correlation(exec)
        const result = await client.quota(exec.signal, requestCorrelation)
        const receipt = await receiptFor(client, requestCorrelation, exec.signal)
        return {
          ...result.apiId === undefined ? {} : { apiId: result.apiId },
          source: result.source,
          fetchedAt: result.fetchedAt,
          ...result.plan === undefined ? {} : { plan: result.plan },
          ...result.usage === undefined ? {} : { usage: result.usage },
          ...receipt === undefined ? {} : { receipt },
        }
      },
      presentCall: () => present('other', 'Read Tako quota'),
    }))
  }
}

/** Report whether a tool result failed.
 * @param result - Completed tool result.
 * @returns Whether the tool reported an error.
 */
export function isFailedToolResult(result: ToolResult): boolean {
  return result.isError
}
