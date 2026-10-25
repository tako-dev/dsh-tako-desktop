/**
 * Small Tako HTTP client shared by model-discovery and billed capability tools.
 * It owns URL normalization, per-operation credential resolution, correlation
 * headers, response decoding, and stable error codes; it never logs a key.
 * @module @deepseek-ai/dsh-tako/api
 */

import { createHash } from 'node:crypto'
import { LlmError } from '@deepseek-ai/dsh-llm'

/** Public default Tako origin. */
export const DEFAULT_TAKO_BASE_URL = 'https://tako.shiroha.tech'

/** Correlation facts attached when a call belongs to an Agent execution. */
export interface TakoCorrelation {
  sessionId?: string
  turnId?: string
  toolCallId?: string
}

/** Read-only request receipt returned by Tako after its ledger settles. */
export interface TakoReceipt {
  correlationId: string
  status: 'settled' | 'pending' | 'unavailable'
  requestId?: string
  createdAt?: number
  model?: string
  usage?: {
    cost?: number
    promptTokens?: number
    completionTokens?: number
  }
}

/** Stable, opaque lookup id shared by DSH headers and Tako's receipt endpoint.
 * @param correlation - DSH session, turn, and optional tool-call identity.
 * @returns A stable opaque id, or undefined when no execution identity exists.
 */
export function takoCorrelationId(correlation: TakoCorrelation): string | undefined {
  const sessionId = correlation.sessionId?.trim() ?? ''
  const turnId = correlation.turnId?.trim() ?? ''
  const toolCallId = correlation.toolCallId?.trim() ?? ''
  if (sessionId === '' && turnId === '' && toolCallId === '') return undefined
  const payload = `session=${sessionId}\nturn=${turnId}\ntool=${toolCallId}`
  return `dsh-${createHash('sha256').update(payload, 'utf8').digest('hex')}`
}

/** A source returned by Tako search. */
export interface TakoSearchSource {
  title?: string
  url: string
  snippet?: string
  publishedAt?: string
}

/** Search response projection used by the model-facing tool. */
export interface TakoSearchResponse {
  query?: string
  provider?: string
  answer?: string
  results?: TakoSearchSource[]
}

/** Image response projection used by the model-facing tool. */
export interface TakoImageResponse {
  data?: Array<{ url?: string; b64_json?: string; mimeType?: string; revised_prompt?: string }>
}

/** Model-directory entry returned by Tako. */
export interface TakoModelEntry {
  /** Stable model identifier used in DSH requests. */
  id: string
  /** Human-readable model name shown by model selectors. */
  name?: string
  /** Optional server-provided description and availability labels. */
  description?: string
  /** Maximum context capacity in tokens, when the catalog provides it. */
  contextWindow?: number
  /** Maximum output capacity in tokens, when the catalog provides it. */
  maxTokens?: number
}

/** One public pricing-directory model card returned by Tako. */
export interface TakoPricingModel {
  model_name: string
  description?: string
  tags?: string
  enable_groups?: string[]
  supported_endpoint_types?: string[]
  model_ratio?: number
}

/** Public pricing directory response. Unknown fields are intentionally ignored. */
export interface TakoPricingResponse {
  data?: TakoPricingModel[]
  usable_group?: Record<string, string>
}

/** Audio transcription response projection. */
export interface TakoTranscriptionResponse {
  text: string
  language?: string
  duration?: number
}

/** Audio response returned by the speech endpoint. */
export interface TakoAudioResponse {
  data: string
  format: string
  mimeType: string
  sizeBytes: number
}

/** Read-only quota snapshot returned for the currently configured API key. */
export interface TakoUsageResponse {
  total_granted?: number
  total_used?: number
  total_available?: number
  unlimited_quota?: boolean
  model_limits?: Record<string, number | null>
  expires_at?: string | number | null
}

/**
 * The API-key quota projection exposed by Tako's apiStats service.
 *
 * `user-quota` is the current stable contract.  `user-stats` is retained as a
 * read-only compatibility fallback for older deployments; callers should not
 * infer a plan name or monetary balance when the server does not return one.
 */
export interface TakoQuotaSnapshot {
  apiId?: string
  account?: {
    balance?: number | null
    used?: number | null
    currency?: string
    plans?: readonly { id?: number; title?: string; expiresAt?: number }[]
  }
  plan?: {
    windowCostLimit?: number | null
    windowMinutes?: number | null
    dailyCostLimit?: number | null
    weeklyCostLimit?: number | null
    monthlyCostLimit?: number | null
  }
  usage?: {
    windowCost?: number | null
    dailyCost?: number | null
    weeklyCost?: number | null
    monthlyCost?: number | null
  }
  /** True when the response came from the older `user-stats` fallback. */
  source: 'user-quota' | 'user-stats'
  fetchedAt: string
}

/** Stable API failure facts without secret material. */
export class TakoApiError extends Error {
  /** Stable category suitable for user-facing error handling. */
  readonly code: string
  /** HTTP status returned by Tako, when the failure came from HTTP. */
  readonly status: number | undefined
  /** Tako request id for support diagnostics, when supplied by the server. */
  readonly requestId: string | undefined

  constructor(message: string, code: string, options: { status?: number; requestId?: string } = {}) {
    super(message)
    this.name = 'TakoApiError'
    this.code = code
    this.status = options.status
    this.requestId = options.requestId
  }
}

/** Fetch-like function seam used by tests and embedders. */
export type TakoFetch = typeof fetch

/** Credentials and transport needed by one Tako client. */
export interface TakoClientOptions {
  baseURL?: string
  /** Optional live resolver for settings-backed endpoint changes. */
  resolveBaseURL?: () => string
  resolveApiKey: () => Promise<string | undefined>
  fetchImpl?: TakoFetch
}

/** Normalize a Tako origin or API prefix to the `/v1` API root.
 * @param raw - Origin or API prefix to normalize.
 * @returns The normalized API root.
 */
export function normalizeBaseURL(raw = DEFAULT_TAKO_BASE_URL): string {
  const value = raw.trim().replace(/\/+$/, '')
  if (value.length === 0) throw new TypeError('Tako baseURL must be non-empty')
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new TypeError('Tako baseURL must be an absolute http(s) URL')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new TypeError('Tako baseURL must use http or https')
  }
  const path = parsed.pathname.replace(/\/+$/, '')
  if (path.endsWith('/v1') || path.endsWith('/api/v1')) return `${parsed.origin}${path}`
  return `${parsed.origin}${path}/v1`
}

/** Map an HTTP status and provider detail to a stable non-secret error code.
 * @param status - HTTP response status.
 * @param detail - Optional provider error text.
 * @returns A stable error category.
 */
export function takoHttpErrorCode(status: number, detail = ''): string {
  const lower = detail.toLowerCase()
  if (status === 401 || status === 403) return 'AUTH'
  if (status === 402 || lower.includes('insufficient') || lower.includes('billing')) return 'BILLING'
  if (status === 429) return 'RATE_LIMIT'
  if (status === 400 || status === 422) return 'INVALID_REQUEST'
  if (status >= 500) return 'SERVER'
  return `HTTP_${status}`
}

function responseRequestId(response: Response): string | undefined {
  const value = response.headers.get('x-request-id') ?? response.headers.get('x-tako-request-id')
  return value === null || value.length === 0 ? undefined : value
}

function errorDetail(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  const error = typeof record.error === 'object' && record.error !== null
    ? record.error as Record<string, unknown>
    : undefined
  const candidates = [record.message, error?.message, record.detail, error?.detail]
  return candidates.find((candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0)
}

/**
 * API client used by Tako tools and model discovery.
 * @param options - endpoint, credential resolver, and optional fetch seam.
 */
export class TakoClient {
  /** Normalized API root used for initial client construction. */
  readonly baseURL: string
  private readonly resolveBaseURL: () => string
  private readonly resolveApiKey: () => Promise<string | undefined>
  private readonly fetchImpl: TakoFetch

  constructor(options: TakoClientOptions) {
    this.baseURL = normalizeBaseURL(options.baseURL)
    this.resolveBaseURL = options.resolveBaseURL ?? (() => this.baseURL)
    this.resolveApiKey = options.resolveApiKey
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  /** Read the public model/pricing directory without requiring an API key.
   * @param signal - Optional cancellation signal.
   * @returns Public pricing-directory data.
   */
  async pricing(signal?: AbortSignal): Promise<TakoPricingResponse> {
    const base = takoOrigin(this.resolveBaseURL())
    let response: Response
    try {
      response = await this.fetchImpl(`${base}/api/pricing`, {
        method: 'GET',
        headers: { accept: 'application/json' },
        ...signal === undefined ? {} : { signal },
      })
    } catch (error: unknown) {
      if (signal?.aborted) throw error
      throw new TakoApiError('Tako pricing request failed', 'TRANSPORT')
    }
    const value = await this.decodeJson(response)
    if (!response.ok) {
      const detail = errorDetail(value) ?? `HTTP ${response.status}`
      const requestId = responseRequestId(response)
      throw new TakoApiError(detail, takoHttpErrorCode(response.status, detail), {
        status: response.status,
        ...(requestId === undefined ? {} : { requestId }),
      })
    }
    return value as TakoPricingResponse
  }

  /** Execute a JSON request with a freshly resolved credential.
   * @param path - Path relative to the normalized API root.
   * @param body - JSON request body, or undefined for a GET.
   * @param signal - Optional cancellation signal.
   * @param correlation - DSH execution identity for request headers.
   * @param method - HTTP method; defaults from whether a body is present.
   * @returns The decoded JSON response.
   */
  async requestJson<T>(
    path: string,
    body: unknown,
    signal: AbortSignal | undefined,
    correlation: TakoCorrelation = {},
    method: 'GET' | 'POST' = body === undefined ? 'GET' : 'POST',
  ): Promise<T> {
    return await this.requestAbsoluteJson<T>(`${normalizeBaseURL(this.resolveBaseURL())}${path}`, body, signal, correlation, method, path)
  }

  /** Read the quota view owned by Tako; this operation never consumes quota.
   * @param signal - Optional cancellation signal.
   * @param correlation - DSH execution identity for request headers.
   * @returns The token quota projection.
   */
  async usage(
    signal: AbortSignal | undefined,
    correlation: TakoCorrelation = {},
  ): Promise<TakoUsageResponse> {
    const value = await this.requestAbsoluteJson<unknown>(
      `${takoOrigin(this.resolveBaseURL())}/api/usage/token/`,
      undefined,
      signal,
      correlation,
      'GET',
      '/api/usage/token/',
    )
    if (isRecord(value) && isRecord(value.data)) return value.data
    return value as TakoUsageResponse
  }

  /**
   * Read the account quota owned by Tako's API-key stats service.
   *
   * The API key is exchanged for a numeric API id through a short-lived POST
   * and is never included in the returned projection or error text.  The
   * server's newer `user-quota` endpoint is preferred, with `user-stats` as a
   * compatibility fallback for older Tako deployments.
   * @param signal - Optional cancellation signal.
   * @param correlation - DSH execution identity for request headers.
   * @returns The normalized API-key quota snapshot.
   */
  async quota(
    signal?: AbortSignal,
    correlation: TakoCorrelation = {},
  ): Promise<TakoQuotaSnapshot> {
    const key = await this.resolveRequiredApiKey()
    const apiId = await this.resolveApiId(key, signal, correlation)
    try {
      const raw = await this.postApiStats<{ success?: boolean; data?: unknown; message?: string }>(
        '/apiStats/api/user-quota', { apiId }, signal, correlation,
      )
      // The current Tako deployment returns `plan` and `usage` at the top
      // level, while older deployments wrapped the same projection in
      // `{ success, data }`. Accept both wire shapes; otherwise a valid
      // quota response is incorrectly reported as unavailable.
      const payload = isRecord(raw.data) ? raw.data : raw
      if (raw.success === false || !isRecord(payload)) {
        throw new TakoApiError('Tako quota response was invalid', 'INVALID_RESPONSE')
      }
      return normalizeQuota(payload, apiId, 'user-quota')
    } catch (error: unknown) {
      if (!(error instanceof TakoApiError) || !isCompatibilityFailure(error)) throw error
      const fallback = await this.postApiStats<{ success?: boolean; data?: unknown; message?: string }>(
        '/apiStats/api/user-stats', { apiId }, signal, correlation,
      )
      if (fallback.success === false || !isRecord(fallback.data)) {
        throw new TakoApiError('Tako quota response was invalid', 'INVALID_RESPONSE')
      }
      return normalizeQuota(fallback.data, apiId, 'user-stats')
    }
  }

  /** Read one request's settled ledger row without creating a second local log.
   * @param correlation - DSH execution identity used to locate the ledger row.
   * @param signal - Optional cancellation signal.
   * @returns The settled, pending, or unavailable receipt projection.
   */
  async receipt(
    correlation: TakoCorrelation,
    signal?: AbortSignal,
  ): Promise<TakoReceipt> {
    const correlationId = takoCorrelationId(correlation)
    if (correlationId === undefined) return { correlationId: '', status: 'unavailable' }
    const key = await this.resolveApiKey()
    if (key === undefined || key.trim().length === 0) return { correlationId, status: 'unavailable' }
    try {
      const apiId = await this.resolveApiId(key.trim(), signal, correlation)
      const raw = await this.postApiStats<Record<string, unknown>>(
        '/apiStats/api/receipt', { apiId, correlationId }, signal, correlation,
      )
      const status = raw.status
      if (status !== 'settled' && status !== 'pending') return { correlationId, status: 'unavailable' }
      const usageValue = isRecord(raw.usage) ? raw.usage : undefined
      const number = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) ? value : undefined
      const createdAt = number(raw.createdAt)
      const cost = number(usageValue?.cost)
      const promptTokens = number(usageValue?.promptTokens)
      const completionTokens = number(usageValue?.completionTokens)
      return {
        correlationId,
        status,
        ...typeof raw.requestId === 'string' ? { requestId: raw.requestId } : {},
        ...createdAt === undefined ? {} : { createdAt },
        ...typeof raw.model === 'string' ? { model: raw.model } : {},
        ...usageValue === undefined ? {} : {
          usage: {
            ...cost === undefined ? {} : { cost },
            ...promptTokens === undefined ? {} : { promptTokens },
            ...completionTokens === undefined ? {} : { completionTokens },
          },
        },
      }
    } catch {
      return { correlationId, status: 'unavailable' }
    }
  }

  /** Execute a multipart audio transcription request.
   * @param input - Audio bytes and optional transcription parameters.
   * @param signal - Optional cancellation signal.
   * @param correlation - DSH execution identity for request headers.
   * @returns The decoded transcription.
   */
  async transcribe(
    input: { audioBase64: string; filename: string; mimeType: string; model?: string; language?: string },
    signal: AbortSignal | undefined,
    correlation: TakoCorrelation,
  ): Promise<TakoTranscriptionResponse> {
    const key = await this.resolveApiKey()
    if (key === undefined || key.trim().length === 0) {
      throw new LlmError('tako: no API key configured; set TAKO_API_KEY in DSH credentials', 'MISSING_CREDENTIAL')
    }
    const bytes = Buffer.from(input.audioBase64, 'base64')
    const form = new FormData()
    form.append('file', new Blob([bytes], { type: input.mimeType }), input.filename)
    if (input.model !== undefined) form.append('model', input.model)
    if (input.language !== undefined) form.append('language', input.language)
    const response = await this.fetchImpl(`${normalizeBaseURL(this.resolveBaseURL())}/audio/transcriptions`, {
      method: 'POST',
      headers: this.headers(key, correlation),
      body: form,
      ...signal === undefined ? {} : { signal },
    })
    const value = await this.decodeJson(response)
    if (!response.ok) {
      const detail = errorDetail(value) ?? `HTTP ${response.status}`
      const requestId = responseRequestId(response)
      throw new TakoApiError(detail, takoHttpErrorCode(response.status, detail), {
        status: response.status,
        ...(requestId === undefined ? {} : { requestId }),
      })
    }
    return value as TakoTranscriptionResponse
  }

  /** Execute the speech endpoint and return the bytes as model-safe base64.
   * @param input - Speech model, text, voice, and output format.
   * @param signal - Optional cancellation signal.
   * @param correlation - DSH execution identity for request headers.
   * @returns Base64 audio and preview metadata.
   */
  async speech(
    input: { model: string; text: string; voice: string; format: string },
    signal: AbortSignal | undefined,
    correlation: TakoCorrelation,
  ): Promise<TakoAudioResponse> {
    const key = await this.resolveApiKey()
    if (key === undefined || key.trim().length === 0) {
      throw new LlmError('tako: no API key configured; set TAKO_API_KEY in DSH credentials', 'MISSING_CREDENTIAL')
    }
    const response = await this.fetchImpl(`${normalizeBaseURL(this.resolveBaseURL())}/audio/speech`, {
      method: 'POST',
      headers: this.headers(key, correlation, 'application/json'),
      body: JSON.stringify({ model: input.model, input: input.text, voice: input.voice, response_format: input.format }),
      ...signal === undefined ? {} : { signal },
    })
    if (!response.ok) {
      const value = await this.decodeJson(response)
      const detail = errorDetail(value) ?? `HTTP ${response.status}`
      const requestId = responseRequestId(response)
      throw new TakoApiError(detail, takoHttpErrorCode(response.status, detail), {
        status: response.status,
        ...(requestId === undefined ? {} : { requestId }),
      })
    }
    const bytes = new Uint8Array(await response.arrayBuffer())
    return {
      data: Buffer.from(bytes).toString('base64'),
      format: input.format,
      mimeType: response.headers.get('content-type') ?? mimeTypeForAudioFormat(input.format),
      sizeBytes: bytes.byteLength,
    }
  }

  private headers(key: string, correlation: TakoCorrelation, contentType?: string): Record<string, string> {
    const correlationId = takoCorrelationId(correlation)
    return {
      authorization: `Bearer ${key}`,
      accept: 'application/json',
      ...contentType === undefined ? {} : { 'content-type': contentType },
      ...correlation.sessionId === undefined ? {} : { 'x-dsh-session-id': correlation.sessionId },
      ...correlation.turnId === undefined ? {} : { 'x-dsh-turn-id': correlation.turnId },
      ...correlation.toolCallId === undefined ? {} : { 'x-dsh-tool-call-id': correlation.toolCallId },
      ...correlationId === undefined ? {} : { 'x-dsh-correlation-id': correlationId },
    }
  }

  private async resolveRequiredApiKey(): Promise<string> {
    const key = await this.resolveApiKey()
    if (key === undefined || key.trim().length === 0) {
      throw new LlmError('tako: no API key configured; set TAKO_API_KEY in DSH credentials', 'MISSING_CREDENTIAL')
    }
    return key.trim()
  }

  private async resolveApiId(key: string, signal: AbortSignal | undefined, correlation: TakoCorrelation): Promise<string> {
    const response = await this.postApiStats<{ success?: boolean; data?: unknown; message?: string }>(
      '/apiStats/api/get-key-id', { apiKey: key }, signal, correlation,
    )
    const id = isRecord(response.data) ? response.data.id : undefined
    if (response.success !== true || (typeof id !== 'string' && typeof id !== 'number')) {
      throw new TakoApiError('Tako rejected the configured API key', 'AUTH')
    }
    return String(id)
  }

  /** POST an apiStats payload without putting the API key in an Authorization header. */
  private async postApiStats<T>(path: string, body: unknown, signal: AbortSignal | undefined, correlation: TakoCorrelation): Promise<T> {
    const correlationId = takoCorrelationId(correlation)
    let response: Response
    try {
      response = await this.fetchImpl(`${takoOrigin(this.resolveBaseURL())}${path}`, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          ...correlation.sessionId === undefined ? {} : { 'x-dsh-session-id': correlation.sessionId },
          ...correlation.turnId === undefined ? {} : { 'x-dsh-turn-id': correlation.turnId },
          ...correlation.toolCallId === undefined ? {} : { 'x-dsh-tool-call-id': correlation.toolCallId },
          ...correlationId === undefined ? {} : { 'x-dsh-correlation-id': correlationId },
        },
        body: JSON.stringify(body),
        ...signal === undefined ? {} : { signal },
      })
    } catch (error: unknown) {
      if (signal?.aborted) throw error
      throw new TakoApiError(`Tako request to ${path} failed`, 'TRANSPORT')
    }
    const value = await this.decodeJson(response)
    if (!response.ok) {
      const detail = errorDetail(value) ?? `HTTP ${response.status}`
      const requestId = responseRequestId(response)
      throw new TakoApiError(detail, takoHttpErrorCode(response.status, detail), {
        status: response.status,
        ...(requestId === undefined ? {} : { requestId }),
      })
    }
    return value as T
  }

  private async requestAbsoluteJson<T>(
    url: string,
    body: unknown,
    signal: AbortSignal | undefined,
    correlation: TakoCorrelation,
    method: 'GET' | 'POST',
    errorPath: string,
  ): Promise<T> {
    const key = await this.resolveApiKey()
    if (key === undefined || key.trim().length === 0) {
      throw new LlmError('tako: no API key configured; set TAKO_API_KEY in DSH credentials', 'MISSING_CREDENTIAL')
    }
    const headers = this.headers(key, correlation, body === undefined ? undefined : 'application/json')
    let response: Response
    try {
      response = await this.fetchImpl(url, {
        method,
        headers,
        ...body === undefined ? {} : { body: JSON.stringify(body) },
        ...signal === undefined ? {} : { signal },
      })
    } catch (error: unknown) {
      if (signal?.aborted) throw error
      throw new TakoApiError(`Tako request to ${errorPath} failed`, 'TRANSPORT')
    }
    const value = await this.decodeJson(response)
    if (!response.ok) {
      const detail = errorDetail(value) ?? `HTTP ${response.status}`
      const requestId = responseRequestId(response)
      throw new TakoApiError(detail, takoHttpErrorCode(response.status, detail), {
        status: response.status,
        ...(requestId === undefined ? {} : { requestId }),
      })
    }
    return value as T
  }

  private async decodeJson(response: Response): Promise<unknown> {
    try {
      return await response.json()
    } catch {
      return undefined
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finiteNumber(value: unknown): number | null | undefined {
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return value
}

function pickNumber(record: Record<string, unknown>, ...keys: string[]): number | null | undefined {
  for (const key of keys) {
    const value = finiteNumber(record[key])
    if (value !== undefined) return value
  }
  return undefined
}

function normalizeQuota(value: Record<string, unknown>, apiId: string, source: TakoQuotaSnapshot['source']): TakoQuotaSnapshot {
  const account = isRecord(value.account) ? value.account : undefined
  const plan = isRecord(value.plan) ? value.plan : undefined
  const usage = isRecord(value.usage) ? value.usage : undefined
  const limits = isRecord(value.limits) ? value.limits : undefined
  const normalizedAccount: NonNullable<TakoQuotaSnapshot['account']> = {}
  const normalizedPlan: NonNullable<TakoQuotaSnapshot['plan']> = {}
  const normalizedUsage: NonNullable<TakoQuotaSnapshot['usage']> = {}
  const balance = pickNumber(account ?? {}, 'balance')
  const used = pickNumber(account ?? {}, 'used')
  if (balance !== undefined) normalizedAccount.balance = balance
  if (used !== undefined) normalizedAccount.used = used
  if (typeof account?.currency === 'string' && account.currency.length > 0) normalizedAccount.currency = account.currency
  if (Array.isArray(account?.plans)) {
    const plans = account.plans.flatMap((entry): { id?: number; title?: string; expiresAt?: number }[] => {
      if (!isRecord(entry)) return []
      const id = pickNumber(entry, 'id')
      const expiresAt = pickNumber(entry, 'expiresAt', 'expires_at')
      const title = typeof entry.title === 'string' && entry.title.length > 0 ? entry.title : undefined
      return [{
        ...id == null ? {} : { id },
        ...title === undefined ? {} : { title },
        ...expiresAt == null ? {} : { expiresAt },
      }]
    })
    if (plans.length > 0) normalizedAccount.plans = plans
  }
  const windowCostLimit = pickNumber(plan ?? {}, 'window_cost_limit', 'windowCostLimit')
  const windowMinutes = pickNumber(plan ?? {}, 'window_minutes', 'windowMinutes')
  const dailyCostLimit = pickNumber(plan ?? {}, 'daily_cost_limit', 'dailyCostLimit')
  const weeklyCostLimit = pickNumber(plan ?? {}, 'weekly_cost_limit', 'weeklyCostLimit')
  const monthlyCostLimit = pickNumber(plan ?? {}, 'monthly_cost_limit', 'monthlyCostLimit')
  const windowCost = pickNumber(usage ?? {}, 'windowCost', 'window_cost')
  const dailyCost = pickNumber(usage ?? {}, 'dailyCost', 'daily_cost')
  const weeklyCost = pickNumber(usage ?? {}, 'weeklyCost', 'weekly_cost')
  const monthlyCost = pickNumber(usage ?? {}, 'monthlyCost', 'monthly_cost')
  if (windowCostLimit !== undefined) normalizedPlan.windowCostLimit = windowCostLimit
  if (windowMinutes !== undefined) normalizedPlan.windowMinutes = windowMinutes
  if (dailyCostLimit !== undefined) normalizedPlan.dailyCostLimit = dailyCostLimit
  if (weeklyCostLimit !== undefined) normalizedPlan.weeklyCostLimit = weeklyCostLimit
  if (monthlyCostLimit !== undefined) normalizedPlan.monthlyCostLimit = monthlyCostLimit
  if (windowCost !== undefined) normalizedUsage.windowCost = windowCost
  if (dailyCost !== undefined) normalizedUsage.dailyCost = dailyCost
  if (weeklyCost !== undefined) normalizedUsage.weeklyCost = weeklyCost
  if (monthlyCost !== undefined) normalizedUsage.monthlyCost = monthlyCost
  if (source === 'user-stats') {
    const total = isRecord(value.usage) ? pickNumber(value.usage, 'total', 'totalCost') : undefined
    const dailyLimit = pickNumber(limits ?? {}, 'currentDailyCost', 'daily_cost_limit')
    if (normalizedUsage.dailyCost === undefined && total !== undefined) normalizedUsage.dailyCost = total
    if (normalizedPlan.dailyCostLimit === undefined && dailyLimit !== undefined) normalizedPlan.dailyCostLimit = dailyLimit
  }
  return {
    apiId,
    ...Object.keys(normalizedAccount).length === 0 ? {} : { account: normalizedAccount },
    ...Object.keys(normalizedPlan).length === 0 ? {} : { plan: normalizedPlan },
    ...Object.keys(normalizedUsage).length === 0 ? {} : { usage: normalizedUsage },
    source,
    fetchedAt: new Date().toISOString(),
  }
}

function isCompatibilityFailure(error: TakoApiError): boolean {
  return error.status === 404 || error.code === 'HTTP_404' || error.code === 'INVALID_RESPONSE'
}

/** Resolve the public origin used by non-OpenAI Tako account endpoints. */
function takoOrigin(raw: string): string {
  return normalizeBaseURL(raw).replace(/\/api\/v1$/, '').replace(/\/v1$/, '')
}

/** Map the supported output formats to a useful preview MIME type.
 * @param format - Provider output format.
 * @returns A preview MIME type.
 */
export function mimeTypeForAudioFormat(format: string): string {
  switch (format) {
    case 'wav': return 'audio/wav'
    case 'ogg': return 'audio/ogg'
    case 'opus': return 'audio/opus'
    case 'flac': return 'audio/flac'
    case 'pcm': return 'audio/pcm'
    default: return 'audio/mpeg'
  }
}
