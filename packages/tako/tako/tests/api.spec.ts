import { describe, expect, it, vi } from 'vitest'
import { LlmError } from '@deepseek-ai/dsh-llm'
import {
  normalizeBaseURL,
  TakoApiError,
  TakoClient,
  takoCorrelationId,
  takoHttpErrorCode,
  type TakoFetch,
} from '../src/api.ts'

function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

describe('Tako URL and error contracts', () => {
  it('normalizes origins and preserves supported API prefixes', () => {
    expect(normalizeBaseURL('https://tako.example')).toBe('https://tako.example/v1')
    expect(normalizeBaseURL('https://tako.example/api')).toBe('https://tako.example/api/v1')
    expect(normalizeBaseURL('https://tako.example/v1/')).toBe('https://tako.example/v1')
    expect(normalizeBaseURL('https://tako.example/api/v1/')).toBe('https://tako.example/api/v1')
    expect(() => normalizeBaseURL('tako.example')).toThrow('absolute http(s) URL')
  })

  it('maps provider statuses without exposing response bodies or credentials', () => {
    expect(takoHttpErrorCode(401)).toBe('AUTH')
    expect(takoHttpErrorCode(402)).toBe('BILLING')
    expect(takoHttpErrorCode(429)).toBe('RATE_LIMIT')
    expect(takoHttpErrorCode(503)).toBe('SERVER')
    expect(takoHttpErrorCode(400)).toBe('INVALID_REQUEST')
  })
})

describe('TakoClient', () => {
  it('resolves the key per request and attaches DSH correlation headers', async () => {
    const requests: Array<{ input: string | URL; init?: RequestInit }> = []
    const fetchImpl = vi.fn(async (input: string | URL, init?: RequestInit) => {
      requests.push({ input, ...init === undefined ? {} : { init } })
      return jsonResponse({ answer: 'ok', results: [{ url: 'https://example.test' }] })
    }) as TakoFetch
    const client = new TakoClient({
      baseURL: 'https://tako.example',
      resolveApiKey: async () => 'secret-key',
      fetchImpl,
    })

    const result = await client.requestJson<{ answer: string }>('/search', { query: 'q' }, undefined, {
      sessionId: 'session-1', turnId: 'turn-2', toolCallId: 'call-3',
    })

    expect(result.answer).toBe('ok')
    expect(requests).toHaveLength(1)
    expect(requests[0]?.input).toBe('https://tako.example/v1/search')
    expect(requests[0]?.init?.headers).toEqual(expect.objectContaining({
      authorization: 'Bearer secret-key',
      'x-dsh-session-id': 'session-1',
      'x-dsh-turn-id': 'turn-2',
      'x-dsh-tool-call-id': 'call-3',
    }))
    expect(JSON.parse(requests[0]?.init?.body as string)).toEqual({ query: 'q' })
  })

  it('fails before transport when the credential is missing', async () => {
    const fetchImpl = vi.fn() as TakoFetch
    const client = new TakoClient({ baseURL: 'https://tako.example', resolveApiKey: async () => undefined, fetchImpl })

    await expect(client.requestJson('/search', { query: 'q' }, undefined)).rejects.toMatchObject({ code: 'MISSING_CREDENTIAL' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('returns speech bytes as a model-safe base64 artifact', async () => {
    const fetchImpl = vi.fn(async () => new Response(Uint8Array.from([1, 2, 3]), {
      status: 200,
      headers: { 'content-type': 'audio/wav' },
    })) as TakoFetch
    const client = new TakoClient({ baseURL: 'https://tako.example/v1', resolveApiKey: async () => 'key', fetchImpl })

    await expect(client.speech({ model: 'tts', text: 'hello', voice: 'alloy', format: 'wav' }, undefined, {}))
      .resolves.toEqual({ data: 'AQID', format: 'wav', mimeType: 'audio/wav', sizeBytes: 3 })
  })

  it('re-resolves a settings-backed base URL for each operation', async () => {
    let baseURL = 'https://first.example'
    const inputs: string[] = []
    const fetchImpl = vi.fn(async (input: string | URL) => {
      inputs.push(String(input))
      return jsonResponse({ ok: true })
    }) as TakoFetch
    const client = new TakoClient({
      baseURL,
      resolveBaseURL: () => baseURL,
      resolveApiKey: async () => 'key',
      fetchImpl,
    })

    await client.requestJson('/models', undefined, undefined)
    baseURL = 'https://second.example/api'
    await client.requestJson('/models', undefined, undefined)
    expect(inputs).toEqual(['https://first.example/v1/models', 'https://second.example/api/v1/models'])
  })

  it('reads the key-scoped quota endpoint without changing the request contract', async () => {
    const requests: Array<{ input: string | URL; init?: RequestInit }> = []
    const fetchImpl = vi.fn(async (input: string | URL, init?: RequestInit) => {
      requests.push({ input, ...init === undefined ? {} : { init } })
      return jsonResponse({ code: true, message: 'ok', data: { total_granted: 100, total_used: 25, total_available: 75 } })
    }) as TakoFetch
    const client = new TakoClient({ baseURL: 'https://tako.example', resolveApiKey: async () => 'key', fetchImpl })

    await expect(client.usage(undefined, { toolCallId: 'usage-call' })).resolves.toEqual({
      total_granted: 100,
      total_used: 25,
      total_available: 75,
    })
    expect(requests[0]?.input).toBe('https://tako.example/api/usage/token/')
    expect(requests[0]?.init?.method).toBe('GET')
    expect(requests[0]?.init?.headers).toEqual(expect.objectContaining({
      authorization: 'Bearer key',
      'x-dsh-tool-call-id': 'usage-call',
    }))
  })

  it('keeps account balance and plan metadata in the redacted quota projection', async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = String(input)
      if (url.endsWith('/get-key-id')) return jsonResponse({ success: true, data: { id: '42' } })
      return jsonResponse({ success: true, data: {
        account: { balance: 20, used: 3, currency: 'USD', plans: [{ id: 7, title: 'Tako Pro', expires_at: 1_700_000_000 }] },
        usage: { dailyCost: 2 }, plan: { daily_cost_limit: 10 },
      } })
    }) as TakoFetch
    const client = new TakoClient({ baseURL: 'https://tako.example', resolveApiKey: async () => 'key', fetchImpl })
    await expect(client.quota()).resolves.toMatchObject({ account: {
      balance: 20, used: 3, currency: 'USD', plans: [{ id: 7, title: 'Tako Pro', expiresAt: 1_700_000_000 }],
    } })
  })

  it('normalizes the wrapped quota expiry without exposing the backend envelope', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      code: true,
      message: 'ok',
      data: { total_available: 9, expires_at: 1_725_000_000_000 },
    })) as TakoFetch
    const client = new TakoClient({ baseURL: 'https://tako.example/api/v1', resolveApiKey: async () => 'key', fetchImpl })

    await expect(client.usage(undefined)).resolves.toEqual({ total_available: 9, expires_at: 1_725_000_000_000 })
  })

  it('reads the public pricing directory without sending a credential', async () => {
    const requests: Array<{ input: string | URL; init?: RequestInit }> = []
    const fetchImpl = vi.fn(async (input: string | URL, init?: RequestInit) => {
      requests.push({ input, ...init === undefined ? {} : { init } })
      return jsonResponse({
        usable_group: { mini: 'Mini' },
        data: [{ model_name: 'deepseek-v4-flash', tags: '1M', supported_endpoint_types: ['openai'] }],
      })
    }) as TakoFetch
    const client = new TakoClient({ baseURL: 'https://tako.example/v1', resolveApiKey: async () => 'must-not-be-read', fetchImpl })

    await expect(client.pricing()).resolves.toMatchObject({ data: [{ model_name: 'deepseek-v4-flash' }] })
    expect(requests[0]?.input).toBe('https://tako.example/api/pricing')
    expect(requests[0]?.init?.method).toBe('GET')
    expect(requests[0]?.init?.headers).toEqual({ accept: 'application/json' })
  })

  it('resolves the API id and reads the stable quota contract without echoing the key', async () => {
    const requests: Array<{ input: string | URL; init?: RequestInit }> = []
    const fetchImpl = vi.fn(async (input: string | URL, init?: RequestInit) => {
      requests.push({ input, ...init === undefined ? {} : { init } })
      if (String(input).endsWith('/apiStats/api/get-key-id')) {
        return jsonResponse({ success: true, data: { id: 42 } })
      }
      return jsonResponse({ success: true, data: {
        plan: { window_cost_limit: 3, window_minutes: 60, daily_cost_limit: 10, weekly_cost_limit: 50, monthly_cost_limit: 100 },
        usage: { windowCost: 1, dailyCost: 2, weeklyCost: 4, monthlyCost: 8 },
      } })
    }) as TakoFetch
    const client = new TakoClient({ baseURL: 'https://tako.example', resolveApiKey: async () => 'secret-key', fetchImpl })

    await expect(client.quota(undefined, { toolCallId: 'quota-call' })).resolves.toMatchObject({
      apiId: '42', source: 'user-quota', plan: { windowCostLimit: 3, dailyCostLimit: 10, monthlyCostLimit: 100 }, usage: { dailyCost: 2, monthlyCost: 8 },
    })
    expect(requests).toHaveLength(2)
    expect(requests[0]?.input).toBe('https://tako.example/apiStats/api/get-key-id')
    expect(requests[0]?.init?.headers).not.toHaveProperty('authorization')
    expect(requests[0]?.init?.body as string).toContain('secret-key')
    expect(requests[1]?.init?.body).toBe(JSON.stringify({ apiId: '42' }))
    expect(JSON.stringify(requests[1]?.init?.headers)).not.toContain('secret-key')
  })

  it('accepts the current top-level user-quota response shape', async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      if (String(input).endsWith('/get-key-id')) return jsonResponse({ success: true, data: { id: 7 } })
      return jsonResponse({
        plan: { daily_cost_limit: 0, weekly_cost_limit: 930, window_cost_limit: 200, window_minutes: 300 },
        usage: { dailyCost: 84.133808, weeklyCost: 420.845118, windowCost: 0.05242 },
      })
    }) as TakoFetch
    const client = new TakoClient({ baseURL: 'https://tako.example', resolveApiKey: async () => 'key', fetchImpl })

    await expect(client.quota()).resolves.toMatchObject({
      source: 'user-quota',
      plan: { dailyCostLimit: 0, weeklyCostLimit: 930, windowCostLimit: 200, windowMinutes: 300 },
      usage: { dailyCost: 84.133808, weeklyCost: 420.845118, windowCost: 0.05242 },
    })
  })

  it('reads a settled consumption receipt by the DSH correlation id', async () => {
    const requests: Array<{ input: string | URL; init?: RequestInit }> = []
    const fetchImpl = vi.fn(async (input: string | URL, init?: RequestInit) => {
      requests.push({ input, ...init === undefined ? {} : { init } })
      if (String(input).endsWith('/get-key-id')) return jsonResponse({ success: true, data: { id: 42 } })
      return jsonResponse({
        status: 'settled', correlationId: takoCorrelationId({ sessionId: 's', turnId: '3', toolCallId: 'call' }),
        requestId: 'dsh-request', createdAt: 1_725_000_000, model: 'deepseek-v4-flash',
        usage: { cost: 0.12, promptTokens: 10, completionTokens: 4 },
      })
    }) as TakoFetch
    const client = new TakoClient({ baseURL: 'https://tako.example', resolveApiKey: async () => 'key', fetchImpl })

    await expect(client.receipt({ sessionId: 's', turnId: '3', toolCallId: 'call' })).resolves.toEqual({
      status: 'settled', correlationId: takoCorrelationId({ sessionId: 's', turnId: '3', toolCallId: 'call' }),
      requestId: 'dsh-request', createdAt: 1_725_000_000, model: 'deepseek-v4-flash',
      usage: { cost: 0.12, promptTokens: 10, completionTokens: 4 },
    })
    expect(requests[1]?.init?.body).toBe(JSON.stringify({ apiId: '42', correlationId: takoCorrelationId({ sessionId: 's', turnId: '3', toolCallId: 'call' }) }))
    expect(requests[1]?.init?.headers).toEqual(expect.objectContaining({ 'x-dsh-correlation-id': takoCorrelationId({ sessionId: 's', turnId: '3', toolCallId: 'call' }) }))
  })

  it('falls back to user-stats on older Tako deployments', async () => {
    const paths: string[] = []
    const fetchImpl = vi.fn(async (input: string | URL) => {
      paths.push(String(input))
      if (String(input).endsWith('/get-key-id')) return jsonResponse({ success: true, data: { id: 7 } })
      if (String(input).endsWith('/user-quota')) return new Response('{}', { status: 404 })
      return jsonResponse({ success: true, data: {
        usage: { total: 1.5 }, limits: { currentDailyCost: 5 },
      } })
    }) as TakoFetch
    const client = new TakoClient({ baseURL: 'https://tako.example', resolveApiKey: async () => 'key', fetchImpl })

    await expect(client.quota()).resolves.toMatchObject({ source: 'user-stats', usage: { dailyCost: 1.5 }, plan: { dailyCostLimit: 5 } })
    expect(paths).toEqual([
      'https://tako.example/apiStats/api/get-key-id',
      'https://tako.example/apiStats/api/user-quota',
      'https://tako.example/apiStats/api/user-stats',
    ])
  })

  it('classifies HTTP failures and retains only a non-secret request id', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'quota exhausted' } }), {
      status: 402,
      headers: { 'content-type': 'application/json', 'x-request-id': 'req-1' },
    })) as TakoFetch
    const client = new TakoClient({ baseURL: 'https://tako.example', resolveApiKey: async () => 'key', fetchImpl })

    const error = await client.requestJson('/search', { query: 'q' }, undefined).catch((value: unknown) => value)
    expect(error).toBeInstanceOf(TakoApiError)
    expect(error).toMatchObject({ code: 'BILLING', status: 402, requestId: 'req-1' })
    expect(String(error)).not.toContain('key')
    expect(error).not.toBeInstanceOf(LlmError)
  })
})
