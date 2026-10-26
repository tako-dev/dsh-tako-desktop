import type { ProductEvent } from '@deepseek-ai/dsh-client-product-analytics/types'
/** Native welcome operations using the shared Web authentication and RPC APIs. */

import { randomUUID } from 'node:crypto'
import { desktopAccountBackend, type DesktopAccountBackend } from './account-backend.ts'
import type { WelcomeProvider } from './welcome-api.ts'

/** Metadata needed before the native entry or workspace becomes visible. */
export interface WelcomeState {
  readonly loggedIn: boolean
  readonly hasApiKey: boolean
  readonly writable: boolean
  readonly localePreference: string | null
}

/** Narrow operations available to the native welcome flow. */
export interface DesktopWelcomeBackend {
  /** Provider family selected by the loaded profile. */
  readonly provider: WelcomeProvider
  /** @returns the current Host policy; every read observes live configuration. */
  analyticsEnabled(): Promise<boolean>
  readonly account: DesktopAccountBackend
  /** @param event - desktop-owned fields. @returns after local Host intake. */
  report(event: ProductEvent): Promise<void>
  /** @returns Configured-key presence and the shared language preference, without credential values. */
  read(): Promise<WelcomeState>
  /** @returns The saved UI language without account or provider requests. */
  readLocalePreference(): Promise<string | null>
  /**
   * @param apiKey - User-entered official provider key.
   * @returns A safe write outcome without provider diagnostics.
   */
  save(apiKey: string): Promise<{ ok: true } | { ok: false; reason?: 'invalid' | 'network' }>
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Tako credential settings: workspace bundle, npm plugin, or the pi-ai route it writes. */
export function takoCredentialSettings(namespaces: readonly unknown[]): { apiKeyEnv: string; baseURL?: string } | undefined {
  for (const ns of ['tako', 'llm-tako', 'dsh-tako']) {
    const item: unknown = namespaces.find(entry => record(entry) && entry.ns === ns)
    if (record(item) && record(item.value) && typeof item.value.apiKeyEnv === 'string') {
      return {
        apiKeyEnv: item.value.apiKeyEnv,
        ...typeof item.value.baseURL === 'string' ? { baseURL: item.value.baseURL } : {},
      }
    }
  }
  const piAi: unknown = namespaces.find(entry => record(entry) && entry.ns === 'llm-pi-ai')
  const providers = record(piAi) && record(piAi.value) ? piAi.value.providers : undefined
  const route = record(providers) ? providers.tako : undefined
  if (record(route) && typeof route.apiKeyEnv === 'string') {
    return {
      apiKeyEnv: route.apiKeyEnv,
      ...typeof route.baseURL === 'string' ? { baseURL: route.baseURL } : {},
    }
  }
  return undefined
}

/**
 * Authenticate the native HTTP client through the Web application's launch URL.
 * @param authenticatedUrl - URL supplied by the running Desktop Host.
 * @param send - Electron session fetch, retaining the Web authentication cookie.
 * @returns metadata reads and write-only credential operations over standard RPC.
 */
export async function connectDesktopWelcome(
  authenticatedUrl: string,
  send: (input: string, init?: RequestInit) => Promise<Response>,
  cookies: () => Promise<string> = () => Promise.resolve(''),
  providerFetch: (input: string, init?: RequestInit) => Promise<Response> = fetch,
): Promise<DesktopWelcomeBackend> {
  const origin = new URL(authenticatedUrl).origin
  const authenticated = await send(authenticatedUrl, { credentials: 'include' })
  await authenticated.body?.cancel()
  if (!authenticated.ok) throw new Error('desktop welcome: Web authentication failed')
  const invoke = async (
    request: { namespace: string; method: string; args: Record<string, unknown> },
    signal?: AbortSignal,
  ): Promise<unknown> => {
    const rpcId = randomUUID()
    const method = `${request.namespace}/${request.method}`
    const response = await send(new URL(`/api/${method}`, origin).href, {
      method: 'POST', credentials: 'include', redirect: 'error', ...(signal === undefined ? {} : { signal }),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId, method, payload: { args: request.args } }),
    })
    if (!response.ok) throw new Error('desktop welcome: Web request failed')
    const envelope: unknown = await response.json()
    if (!record(envelope) || envelope.type !== 'server-response' || envelope.rpcId !== rpcId
      || !record(envelope.result) || envelope.result.ok !== true) {
      throw new Error('desktop welcome: Web RPC failed')
    }
    return envelope.result.value
  }
  const account = desktopAccountBackend(origin, invoke, cookies)
  let selectedProvider: WelcomeProvider = 'tako'
  const settingsAndReference = async (): Promise<{
    settings: { namespaces: unknown[] }
    ref: string | undefined
    provider: WelcomeProvider
    baseURL: string | undefined
  }> => {
    const settings = await invoke({ namespace: 'settings', method: 'describe', args: {} })
    if (!record(settings) || !Array.isArray(settings.namespaces)) throw new Error('desktop welcome: missing settings namespaces')
    const tako = takoCredentialSettings(settings.namespaces)
    const official: unknown = settings.namespaces.find((item: unknown) => record(item) && item.ns === 'llm-deepseek')
    if (tako !== undefined) {
      selectedProvider = 'tako'
      return { settings: { namespaces: settings.namespaces }, ref: tako.apiKeyEnv, provider: selectedProvider, baseURL: tako.baseURL }
    }
    if (official === undefined) {
      selectedProvider = 'deepseek'
      return { settings: { namespaces: settings.namespaces }, ref: undefined, provider: selectedProvider, baseURL: undefined }
    }
    if (!record(official) || !record(official.value) || typeof official.value.apiKeyEnv !== 'string') {
      throw new Error('desktop welcome: missing official DeepSeek credential reference')
    }
    selectedProvider = 'deepseek'
    return {
      settings: { namespaces: settings.namespaces },
      ref: official.value.apiKeyEnv,
      provider: selectedProvider,
      baseURL: typeof official.value.baseURL === 'string' ? official.value.baseURL : undefined,
    }
  }
  const localePreference = (namespaces: unknown[]): string | null => {
    const locale: unknown = namespaces.find((item: unknown) => record(item) && item.ns === 'locale')
    if (!record(locale) || !record(locale.value)
      || (locale.value.preference !== undefined && typeof locale.value.preference !== 'string')) {
      throw new Error('desktop welcome: invalid locale preference')
    }
    return locale.value.preference ?? null
  }
  const read = async (): Promise<WelcomeState> => {
    const { settings, ref, provider } = await settingsAndReference()
    const providers = await invoke({ namespace: 'llm', method: 'listConfigurableProviders', args: {} })
    if (!Array.isArray(providers)) throw new Error('desktop welcome: invalid provider directory')
    const namespaces = settings.namespaces
    const refs = providers.flatMap((provider: unknown) => {
      if (!record(provider) || typeof provider.settingsNs !== 'string' || !Array.isArray(provider.settingsPath)) {
        throw new Error('desktop welcome: invalid provider settings address')
      }
      const namespace: unknown = namespaces.find((item: unknown) => record(item) && item.ns === provider.settingsNs)
      let value: unknown = record(namespace) ? namespace.value : undefined
      for (const key of provider.settingsPath as unknown[]) {
        if (typeof key !== 'string') throw new Error('desktop welcome: invalid provider settings path')
        value = record(value) ? value[key] : undefined
      }
      return record(value) && typeof value.apiKeyEnv === 'string' ? [value.apiKeyEnv] : []
    })
    const unique = [...new Set([...(ref === undefined ? [] : [ref]), ...refs])]
    const states: Record<string, unknown> = {}
    // credentials.describe accepts at most 64 references per request.
    for (let offset = 0; offset < unique.length; offset += 64) {
      const batch = await invoke({ namespace: 'credentials', method: 'describe', args: { refs: unique.slice(offset, offset + 64) } })
      if (!record(batch)) throw new Error('desktop welcome: invalid credential metadata')
      Object.assign(states, batch)
    }
    if (ref !== undefined && !record(states[ref])) throw new Error('desktop welcome: missing credential metadata')
    return {
      // The native account flow belongs to DeepSeek. A configured DeepSeek
      // account must not suppress Tako onboarding when the Tako profile is
      // mounted, so only the selected provider can satisfy the key step.
      loggedIn: provider === 'deepseek' && (await account.state()).status === 'credential-stored',
      hasApiKey: selectedProvider === 'tako' && ref !== undefined
        ? record(states[ref]) && states[ref].configured === true
        : Object.values(states).some(value => record(value) && value.configured === true),
      writable: ref !== undefined && record(states[ref]) && states[ref].writable === true,
      localePreference: localePreference(namespaces),
    }
  }
  return {
    get provider() { return selectedProvider },
    account,
    read,
    async analyticsEnabled() {
      const enabled = await invoke({ namespace: 'productAnalytics', method: 'enabled', args: {} }, AbortSignal.timeout(1000))
      if (typeof enabled !== 'boolean') throw new Error('desktop analytics: invalid collection policy')
      return enabled
    },
    async report(event) { await invoke({ namespace: 'productAnalytics', method: 'report', args: { event } }, AbortSignal.timeout(1000)) },
    async readLocalePreference() {
      const settings = await invoke({ namespace: 'settings', method: 'describe', args: {} })
      if (!record(settings) || !Array.isArray(settings.namespaces)) throw new Error('desktop welcome: missing settings namespaces')
      return localePreference(settings.namespaces)
    },
    async save(apiKey) {
      if (!/^[\x21-\x7e]+$/.test(apiKey)) return { ok: false }
      try {
        const { ref, provider, baseURL } = await settingsAndReference()
        if (ref === undefined) return { ok: false }
        if (provider === 'tako') {
          if (baseURL === undefined) return { ok: false, reason: 'network' }
          let origin: string
          try {
            const url = new URL(baseURL)
            if (url.protocol !== 'https:' && url.protocol !== 'http:') return { ok: false, reason: 'network' }
            origin = url.origin
          } catch {
            return { ok: false, reason: 'network' }
          }
          let response: Response
          try {
            response = await providerFetch(`${origin}/v1/models`, {
              method: 'GET',
              headers: { accept: 'application/json', authorization: `Bearer ${apiKey}` },
              signal: AbortSignal.timeout(8_000),
            })
          } catch {
            return { ok: false, reason: 'network' }
          }
          if (response.status === 401 || response.status === 403) return { ok: false, reason: 'invalid' }
          if (!response.ok) return { ok: false, reason: 'network' }
          await response.body?.cancel()
        }
        await invoke({ namespace: 'credentials', method: 'set', args: { ref, value: apiKey } })
        return { ok: true }
      } catch {
        // Provider diagnostics may contain credentials; the native form owns failure copy.
        return { ok: false }
      }
    },
  }
}
