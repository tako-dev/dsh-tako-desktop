/**
 * Tako provider bundle for DeepSeek Harness. Text calls reuse the official
 * OpenAI-compatible adapter while billed non-chat capabilities are registered
 * as ordinary DSH tools.
 * @module @deepseek-ai/dsh-tako
 */

import type { Context, Volatile } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { isVolatile } from '@deepseek-ai/cosmokit'
import z from '@deepseek-ai/schemastery'
import { assertUsableApiKey, LlmError, resolveRetryPolicy, RetryPolicySchema } from '@deepseek-ai/dsh-llm'
import type { AdapterRegistrationHandle, DirectoryRegistrationHandle, RetryPolicyConfig } from '@deepseek-ai/dsh-llm'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
// Activates the webserver Context merge used to publish the profile marker
// before the browser client modules start.
import type {} from '@deepseek-ai/dsh-host-webserver'
import {
  authContextFrom,
  buildProvider,
  credentialStoreFrom,
  PiAiAdapter,
  resolveRouteModels,
} from '@deepseek-ai/dsh-llm-pi-ai'
import type { ResolvedPiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import type {} from '@deepseek-ai/dsh-settings'
import { deepEqualJson } from '@deepseek-ai/dsh-util-values'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import type {} from '@deepseek-ai/dsh-skill'
import type { TakoModelEntry, TakoPricingModel } from './api.ts'
import { DEFAULT_TAKO_BASE_URL, normalizeBaseURL, TakoClient } from './api.ts'
import { applyTakoTools } from './tools.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Read-only Tako account client exposed to Host Remote controllers. */
    takoClient: TakoClient
  }
}

export * from './api.ts'
export {
  assertTakoCompatibility,
  automaticTakoCuratedPlugins,
  cdnOrder,
  compareTakoVersions,
  createTakoInstallPlan,
  detectTakoReleasePlatform,
  downloadTakoArtifact,
  executeTakoInstallPlan,
  fetchTakoCuratedCatalog,
  fetchTakoReleaseManifest,
  parseTakoReleaseManifest,
  parseTakoCuratedCatalog,
  resolveTakoCuratedCatalog,
  selectTakoInstallArtifact,
  TAKO_INSTALL_STEPS,
  verifyTakoSha256,
  verifyTakoSignature,
} from './release.ts'
export type {
  TakoCuratedCatalog,
  TakoCuratedCatalogResult,
  TakoCuratedCatalogStore,
  TakoCuratedKeyResolver,
  TakoCuratedManifestRef,
  TakoCuratedPlugin,
  TakoCdnChannel,
  TakoInstallArtifact,
  TakoInstallOperations,
  TakoInstallPlan,
  TakoInstallProgress,
  TakoInstallResult,
  TakoInstallStep,
  TakoReleaseArtifact,
  TakoReleaseManifest,
  TakoReleasePlatform,
} from './release.ts'
export { applyTakoTools } from './tools.ts'
export type { TakoToolClient, TakoToolConfig } from './tools.ts'

/** Cordis plugin name. */
export const name = 'tako'

/** Required DSH services. */
export const inject = ['llm', 'tools', 'systemPrompt', 'credentials']

const PROVIDER = 'tako'
const NS = 'llm-tako'
const DEFAULT_API_KEY_ENV = 'TAKO_API_KEY'
const DEFAULT_REFRESH_MS = 300_000
const DEFAULT_CONTEXT_WINDOW = 1_000_000
const DEFAULT_MAX_TOKENS = 256_000
const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 300_000
/** Browser bootstrap marker for Tako-first desktop profiles. */
export const TAKO_PROFILE_GLOBAL = '__DSH_TAKO_PROFILE__'
/** Page global the Web client reads to retitle the product (see ui-layout DocumentTitle). */
export const CLIENT_TITLE_GLOBAL = '__DSH_CLIENT_TITLE__'
/** Product title shown in the browser/document title under the Tako profile. */
export const TAKO_CLIENT_TITLE = 'DSH Tako'

/** Fallback catalog used before the first successful Tako directory response. */
export const DEFAULT_MODELS: TakoModelEntry[] = [
  { id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', contextWindow: DEFAULT_CONTEXT_WINDOW },
  { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro', contextWindow: DEFAULT_CONTEXT_WINDOW },
]

/** Tako bundle configuration, also used as the `llm-tako` settings section. */
export interface Config {
  /** DSH credential reference; defaults to `TAKO_API_KEY`. */
  apiKeyEnv: Volatile<string>
  /** Tako origin or `/v1` API prefix. */
  baseURL: Volatile<string>
  /** Default reasoning policy for text calls. */
  thinking: Volatile<'enabled' | 'disabled'>
  /** Default adapter-owned effort. */
  reasoningEffort: Volatile<'off' | 'high' | 'max'>
  /** Default output cap. */
  maxTokens: Volatile<number>
  /** Default exact-model context capacity. */
  defaultContextWindow: Volatile<number>
  /** Fallback model catalog; the live endpoint replaces it on success. */
  models: Volatile<TakoModelEntry[]>
  /** Maximum idle interval for one text stream. */
  streamIdleTimeoutMs: Volatile<number>
  /** Model-directory refresh interval. */
  catalogRefreshMs: Volatile<number>
  /** Provider-owned retry policy. */
  retryPolicy: Volatile<RetryPolicyConfig | undefined>
  /** Models called out as recommended in the selector. */
  recommendedModels: Volatile<string[]>
  /** Enable billed web search. */
  search: Volatile<boolean>
  /** Enable billed image generation. */
  image: Volatile<boolean>
  /** Enable billed speech transcription. */
  transcribe: Volatile<boolean>
  /** Enable billed speech generation. */
  speech: Volatile<boolean>
  /** Enable the read-only quota tool. */
  usage: Volatile<boolean>
  /** Tool timeout. */
  toolTimeoutMs: Volatile<number>
}

/** Plain configuration values captured from live settings for one operation. */
export type Options = { [K in keyof Config]?: Config[K] extends Volatile<infer T> ? Exclude<T, undefined> : never }

function plainOptions(config: Config): Options {
  return Object.fromEntries(Object.entries(config).map(([key, value]) => [key, isVolatile(value) ? value.get() : value]))
}

const catalogModel: z<TakoModelEntry> = z.object({
  id: z.string().required(),
  name: z.string(),
  description: z.string(),
  contextWindow: z.number().step(1).min(1),
  maxTokens: z.number().step(1).min(1),
})

/** Runtime config schema. */
export const Config = z.object({
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV).volatile(),
  baseURL: z.string().default(DEFAULT_TAKO_BASE_URL).volatile(),
  thinking: z.union(['enabled', 'disabled']).default('enabled').volatile(),
  // Tako's live model directory does not currently advertise reasoning
  // capabilities for every model (for example deepseek-v4.1-flash). Keep
  // ordinary chat calls usable by default; users can opt into a supported
  // effort from the provider settings when a model exposes one.
  reasoningEffort: z.union(['off', 'high', 'max']).default('off').volatile(),
  maxTokens: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_MAX_TOKENS).volatile(),
  defaultContextWindow: z.number().step(1).min(1).default(DEFAULT_CONTEXT_WINDOW).volatile(),
  models: z.array(catalogModel).default(DEFAULT_MODELS).volatile(),
  streamIdleTimeoutMs: z.number().min(Number.MIN_VALUE).max(MAX_TIMER_DELAY_MS).default(DEFAULT_STREAM_IDLE_TIMEOUT_MS).volatile(),
  catalogRefreshMs: z.number().min(1).max(MAX_TIMER_DELAY_MS).default(DEFAULT_REFRESH_MS).volatile(),
  retryPolicy: RetryPolicySchema.volatile(),
  recommendedModels: z.array(z.string()).default(['deepseek-v4-flash', 'deepseek-v4-pro']).volatile(),
  search: z.boolean().default(true).volatile(),
  image: z.boolean().default(true).volatile(),
  transcribe: z.boolean().default(true).volatile(),
  speech: z.boolean().default(true).volatile(),
  usage: z.boolean().default(true).volatile(),
  toolTimeoutMs: z.number().min(1).max(MAX_TIMER_DELAY_MS).default(120_000).volatile(),
})

function validateCatalog(models: readonly TakoModelEntry[]): TakoModelEntry[] {
  const seen = new Set<string>()
  const result: TakoModelEntry[] = []
  for (const model of models) {
    const id = model.id.trim()
    if (id.length === 0 || id.startsWith('jev-') || seen.has(id)) continue
    seen.add(id)
    result.push({
      id,
      ...model.name === undefined ? {} : { name: model.name },
      ...model.description === undefined ? {} : { description: model.description },
      ...model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow },
      ...model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens },
    })
  }
  return result
}

function contextWindowFromTags(tags: string | undefined): number | undefined {
  const match = /(?:^|,|\s)(\d+(?:\.\d+)?)([KM])(?:$|,|\s)/i.exec(tags ?? '')
  if (match === null) return undefined
  const value = Number(match[1]) * (match[2]?.toUpperCase() === 'M' ? 1_000_000 : 1_000)
  return Number.isSafeInteger(value) && value > 0 ? value : undefined
}

function catalogFromPricing(
  models: readonly TakoPricingModel[],
  recommended: readonly string[],
  usableGroups: Readonly<Record<string, string>> | undefined,
): TakoModelEntry[] {
  const recommendedSet = new Set(recommended)
  return validateCatalog(models
    .filter(model => model.model_name.trim().length > 0)
    .filter(model => (model.supported_endpoint_types ?? []).some(type =>
      type === 'openai' || type === 'openai-response' || type === 'anthropic' || type === 'gemini'))
    .map((model) => {
      const available = (model.enable_groups ?? []).some(group =>
        group === 'default' || usableGroups === undefined || usableGroups[group] !== undefined)
      const labels = [
        model.tags,
        recommendedSet.has(model.model_name) ? '推荐' : undefined,
        available ? '套餐可用' : '当前套餐不可用',
      ].filter((value): value is string => value !== undefined && value.length > 0)
      const description = [model.description, labels.length === 0 ? undefined : `[${labels.join(' · ')}]`]
        .filter((value): value is string => value !== undefined)
        .join(' ')
      const contextWindow = contextWindowFromTags(model.tags)
      return {
        id: model.model_name,
        name: model.model_name,
        ...description.length === 0 ? {} : { description },
        ...contextWindow === undefined ? {} : { contextWindow },
      }
    }))
}

function validateConfig(config: Options): void {
  if (config.thinking === 'disabled' && config.reasoningEffort !== undefined && config.reasoningEffort !== 'off') {
    throw new Error('tako: reasoningEffort must be "off" when thinking is disabled')
  }
  if (config.maxTokens !== undefined && (!Number.isSafeInteger(config.maxTokens) || config.maxTokens <= 0)) {
    throw new Error('tako: maxTokens must be a positive safe integer')
  }
  if (config.defaultContextWindow !== undefined
    && (!Number.isSafeInteger(config.defaultContextWindow) || config.defaultContextWindow <= 0)) {
    throw new Error('tako: defaultContextWindow must be a positive safe integer')
  }
}

/** Provider adapter that refreshes the public directory before catalog reads. */
class TakoAdapter extends PiAiAdapter {
  constructor(private readonly refreshCatalog: () => Promise<void>, options: ConstructorParameters<typeof PiAiAdapter>[0]) {
    super(options)
  }

  override async listModels(provider: string) {
    await this.refreshCatalog()
    return await super.listModels(provider)
  }

  override async resolveModel(provider: string, model: string, signal?: AbortSignal) {
    await this.refreshCatalog()
    return await super.resolveModel(provider, model, signal)
  }

  override async prepareCall(provider: string, model: string, signal?: AbortSignal) {
    await this.refreshCatalog()
    return await super.prepareCall(provider, model, signal)
  }
}

function correlationSkillContent(baseURL: string): string {
  return [
    'Use Tako tools for billed web search, image generation, speech transcription, and speech generation. Use tako_usage when the user asks about remaining quota.',
    'Search results include source URLs; cite those URLs in the answer.',
    `The active Tako API endpoint is ${baseURL}. Keep credentials in DSH credentials and never print TAKO_API_KEY.`,
    'Do not treat systemone as a chat model; it is not enabled by this bundle.',
  ].join('\n\n')
}

/** Resolve a Tako key through DSH without caching it between operations. */
async function resolveCredential(ctx: Context, ref: CredentialRef): Promise<string> {
  const hit = await ctx.credentials.resolve(ref)
  if (hit === undefined) {
    throw new LlmError(`tako: no API key for provider route "${PROVIDER}"; configure ${ref} in DSH credentials`, 'MISSING_CREDENTIAL')
  }
  return assertUsableApiKey(hit.value, 'tako', ref)
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * True when npm `dsh-tako` already owns `llm-pi-ai.providers.tako`.
 * That route carries the live pricing catalog; this bundle must not also
 * claim provider id `tako` or the chat picker stays empty.
 */
export function pluginOwnsTakoRoute(ctx: Context): boolean {
  const settings = ctx.get('settings') as { describe?: () => unknown } | undefined
  if (settings?.describe === undefined) return false
  let namespaces: unknown
  try { namespaces = settings.describe() }
  catch { return false }
  if (!Array.isArray(namespaces)) return false
  const piAi = namespaces.find(entry => record(entry) && entry.ns === 'llm-pi-ai')
  if (!record(piAi)) return false
  for (const layer of [piAi.user, piAi.value]) {
    if (record(layer) && record(layer.providers) && record(layer.providers.tako)) return true
  }
  return false
}

function isDuplicateClaim(error: unknown, code: string): boolean {
  return error instanceof LlmError && error.code === code
}

/** Register the provider, tools, settings section, and embedded Tako skill. */
export function apply(ctx: Context, config: Config): void {
  // The account client uses this immutable bootstrap marker to hide the
  // official DeepSeek account surface in a Tako profile. Keeping it out of the
  // account settings form avoids making Desktop onboarding wait on a synthetic
  // config field during first launch.
  ctx.on('webserver/index-inject', (table) => {
    table.push({ kind: 'global', name: TAKO_PROFILE_GLOBAL, value: true })
    // The shared Web build is titled "DeepSeek Harness"; the Tako profile shows its own product name.
    table.push({ kind: 'global', name: CLIENT_TITLE_GLOBAL, value: TAKO_CLIENT_TITLE })
  })
  const current: () => Options = () => plainOptions(config)
  let lastSnapshot: string | undefined
  let lastGood: ResolvedPiAiProviderProfile | undefined
  let catalog = validateCatalog(current().models ?? DEFAULT_MODELS)
  validateConfig({ ...current(), models: catalog })
  let catalogFetchedAt = 0
  let catalogRefresh: Promise<void> | undefined

  const options = (): ResolvedPiAiProviderProfile => {
    const raw = current()
    const snapshot = JSON.stringify({ raw, catalog })
    if (snapshot === lastSnapshot && lastGood !== undefined) return lastGood
    const baseURL = normalizeBaseURL(raw.baseURL ?? DEFAULT_TAKO_BASE_URL)
    const route = resolveRouteModels({
      provider: PROVIDER,
      api: 'openai-completions',
      baseURL,
      models: catalog.map(model => ({
        id: model.id,
        ...model.name === undefined ? {} : { name: model.name },
        ...model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow },
        ...model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens },
      })),
      defaultContextWindow: raw.defaultContextWindow ?? DEFAULT_CONTEXT_WINDOW,
      defaultMaxTokens: raw.maxTokens ?? DEFAULT_MAX_TOKENS,
      defaultInput: ['text'],
    }, 'deferred')
    const models = route.models
    const piProvider = buildProvider({
      provider: PROVIDER,
      displayName: 'Tako',
      api: 'openai-completions',
      baseURL,
      models,
      namesCredential: true,
    })
    const next: ResolvedPiAiProviderProfile = {
      provider: PROVIDER,
      displayName: 'Tako',
      api: 'openai-completions',
      baseURL,
      apiKeyEnv: credentialRef(raw.apiKeyEnv ?? DEFAULT_API_KEY_ENV),
      piProvider,
      modelErrors: route.modelErrors,
      configuredMaxTokens: route.configuredMaxTokens,
      streamIdleTimeoutMs: raw.streamIdleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS,
      maxRequestImageBytes: 20 * 1024 * 1024,
      requestImagePixelBudget: 2048 * 2048,
      requestImageMaxBytes: 1024 * 1024,
      retryPolicy: resolveRetryPolicy(raw.retryPolicy, 'tako.retryPolicy'),
      // `off` means the provider's default request shape: omit reasoning
      // entirely.  Sending an explicit `reasoning_effort=off` is rejected by
      // some Tako model routes (including deepseek-v4.1-flash), and the
      // failure is surfaced as a misleading conversation-id error.
      ...raw.thinking === 'disabled' || raw.reasoningEffort === 'off' ? {} : { reasoning: raw.reasoningEffort === 'max' ? 'max' : 'high' },
      headers: {},
    }
    lastSnapshot = snapshot
    lastGood = next
    return next
  }
  const initial = options()
  const client = new TakoClient({
    baseURL: initial.baseURL ?? DEFAULT_TAKO_BASE_URL,
    resolveBaseURL: () => current().baseURL ?? DEFAULT_TAKO_BASE_URL,
    resolveApiKey: () => resolveCredential(
      ctx,
      credentialRef(current().apiKeyEnv ?? DEFAULT_API_KEY_ENV),
    ),
  })
  // Account UI Remote methods read this service without receiving the key or
  // a client-owned secret over the wire.  The service lifetime follows this
  // bundle, and every operation still resolves the current credential.
  ctx.provide('takoClient', client)
  const refreshCatalog = async (): Promise<void> => {
    const now = Date.now()
    const interval = current().catalogRefreshMs ?? DEFAULT_REFRESH_MS
    if (catalogFetchedAt > 0 && now - catalogFetchedAt < interval) return
    if (catalogRefresh !== undefined) {
      await catalogRefresh
      return
    }
    catalogRefresh = (async () => {
      try {
        let next: TakoModelEntry[] = []
        try {
          const publicDirectory = await client.pricing()
          next = catalogFromPricing(
            publicDirectory.data ?? [],
            current().recommendedModels ?? ['deepseek-v4-flash', 'deepseek-v4-pro'],
            publicDirectory.usable_group,
          )
        } catch {
          const response = await client.requestJson<{ data?: TakoModelEntry[] }>('/models', undefined, undefined)
          next = validateCatalog(response.data ?? [])
        }
        if (next.length > 0) {
          catalog = next
          lastSnapshot = undefined
          lastGood = undefined
        }
        catalogFetchedAt = Date.now()
      } catch (error: unknown) {
        // A selector can still use the last successful or bundled catalog while
        // the endpoint is unavailable. The next explicit refresh retries it.
        ctx.logger.warn('tako: model catalog refresh failed; keeping the last successful catalog')
        ctx.logger.warn(error)
      } finally {
        catalogRefresh = undefined
      }
    })()
    await catalogRefresh
  }

  const profiles = (): ReadonlyMap<string, ResolvedPiAiProviderProfile> => new Map([[PROVIDER, options()]])
  const adapter = new TakoAdapter(refreshCatalog, {
    profiles,
    resolveApiKey: async (_provider, profile) => resolveCredential(ctx, profile.apiKeyEnv ?? credentialRef(DEFAULT_API_KEY_ENV)),
    auth: { credentials: credentialStoreFrom(ctx), authContext: authContextFrom(ctx) },
    resolveAttachments: () => ctx.get('attachments'),
  })
  let directory: DirectoryRegistrationHandle | undefined
  let registration: AdapterRegistrationHandle | undefined
  let yieldedToPlugin = false
  const releaseChatRoute = (): void => {
    if (yieldedToPlugin) return
    yieldedToPlugin = true
    const adapterHandle = registration
    const directoryHandle = directory
    registration = undefined
    directory = undefined
    try { adapterHandle?.() }
    catch { /* already released */ }
    try { directoryHandle?.() }
    catch { /* already released */ }
    queueMicrotask(() => { ctx.emit('loader/volatile-update', []) })
  }
  const claimChatRoute = (): void => {
    if (pluginOwnsTakoRoute(ctx) || yieldedToPlugin) {
      if (registration !== undefined || directory !== undefined) releaseChatRoute()
      return
    }
    if (directory === undefined) {
      try {
        directory = ctx.llm.registerConfigurableProviders([
          { provider: PROVIDER, displayName: 'Tako', settingsNs: NS, settingsPath: [] },
        ])
      } catch (error: unknown) {
        if (!isDuplicateClaim(error, 'DUPLICATE_DIRECTORY')) throw error
        ctx.logger.warn('tako: chat directory already owned; keeping tools and credentials')
        ctx.logger.warn(error)
      }
    }
    if (registration === undefined) {
      try {
        registration = ctx.llm.registerAdapter([PROVIDER], adapter)
      } catch (error: unknown) {
        if (!isDuplicateClaim(error, 'DUPLICATE_ADAPTER')) throw error
        ctx.logger.warn('tako: chat adapter already owned; keeping tools and credentials')
        ctx.logger.warn(error)
      }
    }
  }
  claimChatRoute()
  let registeredPolicy = initial.retryPolicy
  const ensureRegistrationFacts = (): void => {
    if (registration === undefined || pluginOwnsTakoRoute(ctx) || yieldedToPlugin) return
    const policy = options().retryPolicy
    if (deepEqualJson(policy, registeredPolicy)) return
    registration.replace([PROVIDER])
    registeredPolicy = policy
  }
  ctx.inject(['settings'], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
    claimChatRoute()
  })
  ctx.on('loader/volatile-update', () => {
    claimChatRoute()
    ensureRegistrationFacts()
  })

  const toolOptions = current()
  applyTakoTools(ctx, client, {
    search: toolOptions.search ?? true,
    image: toolOptions.image ?? true,
    transcribe: toolOptions.transcribe ?? true,
    speech: toolOptions.speech ?? true,
    usage: toolOptions.usage ?? true,
    timeoutMs: toolOptions.toolTimeoutMs ?? 120_000,
  })
  const skills = ctx.get('skills')
  skills?.register({
    name: 'tako',
    description: 'Use Tako for billed search, image generation, and audio tools.',
    content: correlationSkillContent(client.baseURL),
    source: 'runtime',
    invocation: { modelInvocable: true, userInvocable: true },
  })
}
