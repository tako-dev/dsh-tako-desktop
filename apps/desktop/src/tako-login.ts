/** One-time loopback handoff used by the Tako browser-login fallback. */

import { createHash, randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { hostname as osHostname } from 'node:os'

const MAX_BODY_BYTES = 8 * 1024
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000
const API_KEY_PATTERN = /^[\x21-\x7e]{1,512}$/u
const CLIENT_ID = 'dsh-desktop'
const CALLBACK_PATH = '/tako/callback'
const DEVICE_NAME_PREFIX = 'DSH-Tako@'
/** Tako's limit for the `device_name` authorization parameter. */
const MAX_DEVICE_NAME_LENGTH = 32
const DEVICE_NAME_EDGE = /^[-._+]+|[-._+]+$/gu

/**
 * Reduce a host name to its first DNS label in the characters a Tako device name accepts.
 * @param hostname - Host name as reported by the operating system, for example `Studio.local`.
 * @returns The label with other characters replaced by `-`, repeated `-` merged, and edge punctuation removed; empty when nothing remains.
 */
export function takoHostLabel(hostname: string): string {
  return (hostname.trim().split('.')[0] ?? '')
    .replace(/[^A-Za-z0-9._+-]/gu, '-')
    .replace(/-{2,}/gu, '-')
    .replace(DEVICE_NAME_EDGE, '')
}

/**
 * Default device name sent to the Tako authorization page. Tako revokes an older token with the same
 * device name, so the host name keeps machines on one platform from replacing each other's key while a
 * new sign-in on the same machine still replaces that machine's previous key.
 * @param hostname - Host name; defaults to os.hostname().
 * @param platform - Fallback label when the host name yields nothing; defaults to process.platform.
 * @returns `DSH-Tako@<host label>` or `DSH-Tako@<platform>`, at most 32 characters and never ending in `.`, `-`, `_`, or `+`.
 */
export function defaultTakoDeviceName(hostname: string = osHostname(), platform: string = process.platform): string {
  const label = takoHostLabel(hostname) || takoHostLabel(platform)
  return `${DEVICE_NAME_PREFIX}${label}`.slice(0, MAX_DEVICE_NAME_LENGTH).replace(/[-._+]+$/u, '')
}

export type TakoBrowserLoginResult =
  | { readonly ok: true; readonly apiKey: string }
  | { readonly ok: false; readonly reason: 'cancelled' | 'expired' | 'failed' }

export interface TakoBrowserLoginHandle {
  readonly authorizeUrl: string
  readonly wait: Promise<TakoBrowserLoginResult>
  cancel(): void
}

export interface TakoBrowserLoginOptions {
  /** Public origin that owns the login page and token endpoint. */
  readonly websiteOrigin?: string
  /** Test-only timeout override; production uses ten minutes. */
  readonly timeoutMs?: number
  /** Test-only fetch override. */
  readonly fetchImpl?: typeof fetch
  /** Device label shown on the Tako authorization page; defaults to {@link defaultTakoDeviceName}. */
  readonly deviceName?: string
}

function textResponse(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'text/plain; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  })
  response.end(body)
}

async function readBody(request: IncomingMessage): Promise<string | undefined> {
  const declared = Number(request.headers['content-length'] ?? '')
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return undefined
  const chunks: Buffer[] = []
  let length = 0
  for await (const chunk of request) {
    const bytes: Buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)
    length += bytes.byteLength
    if (length > MAX_BODY_BYTES) return undefined
    chunks.push(bytes)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function closeServer(server: Server | undefined): void {
  if (server === undefined || !server.listening) return
  server.close(() => {})
}

function createCodeVerifier(): string {
  return randomBytes(32).toString('base64url')
}

function createCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

function extractApiKey(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const data = record.data
  const candidate = typeof data === 'object' && data !== null && !Array.isArray(data)
    ? (data as Record<string, unknown>).key
    : record.key
  return typeof candidate === 'string' && API_KEY_PATTERN.test(candidate) ? candidate : undefined
}

async function exchangeCode(
  origin: URL,
  callbackURL: string,
  code: string,
  codeVerifier: string,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
): Promise<string | undefined> {
  let response: Response
  try {
    response = await fetchImpl(new URL('/api/desktop/token', origin), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        code_verifier: codeVerifier,
        redirect_uri: callbackURL,
        client_id: CLIENT_ID,
      }),
      signal,
    })
  } catch {
    return undefined
  }
  if (!response.ok) return undefined
  try {
    return extractApiKey(await response.json())
  } catch {
    return undefined
  }
}

/** Start one authenticated browser handoff and consume exactly one callback. */
export async function startTakoBrowserLogin(options: TakoBrowserLoginOptions = {}): Promise<TakoBrowserLoginHandle> {
  const websiteOrigin = options.websiteOrigin ?? 'https://tako.shiroha.tech'
  const parsedOrigin = new URL(websiteOrigin)
  if (parsedOrigin.protocol !== 'https:' && parsedOrigin.protocol !== 'http:') {
    throw new Error('tako login: website origin must use http or https')
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error('tako login: timeout must be positive')
  const state = randomBytes(32).toString('base64url')
  const codeVerifier = createCodeVerifier()
  const codeChallenge = createCodeChallenge(codeVerifier)
  const fetchImpl = options.fetchImpl ?? fetch
  const deviceName = options.deviceName ?? defaultTakoDeviceName()
  const abortController = new AbortController()
  // Assigned once the listener is open; the callback handler and finish() read them later.
  const handles: { server?: Server; callbackURL?: string; timer?: NodeJS.Timeout } = {}
  let settled = false
  let callbackInFlight = false
  let resolveResult!: (result: TakoBrowserLoginResult) => void
  const wait = new Promise<TakoBrowserLoginResult>((resolve) => { resolveResult = resolve })
  const finish = (result: TakoBrowserLoginResult): void => {
    if (settled) return
    settled = true
    if (handles.timer !== undefined) clearTimeout(handles.timer)
    abortController.abort()
    closeServer(handles.server)
    resolveResult(result)
  }

  const handleCallback = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (url.pathname !== CALLBACK_PATH) {
      textResponse(response, 404, 'Not found')
      return
    }
    if (request.method !== 'GET') {
      textResponse(response, 405, 'Method not allowed')
      return
    }
    if (callbackInFlight || settled) {
      textResponse(response, 409, 'Login callback already handled')
      return
    }
    const callbackState = url.searchParams.get('state')
    if (callbackState !== state) {
      textResponse(response, 400, 'Invalid login state')
      return
    }
    const error = url.searchParams.get('error')
    if (error !== null) {
      textResponse(response, 400, 'Tako authorization was not completed.')
      finish({ ok: false, reason: 'failed' })
      return
    }
    const code = url.searchParams.get('code')
    if (code === null || code.length === 0) {
      textResponse(response, 400, 'Missing authorization code')
      return
    }
    callbackInFlight = true
    const body = await readBody(request)
    if (body === undefined) {
      textResponse(response, 413, 'Request too large')
      callbackInFlight = false
      return
    }
    const callbackURL = handles.callbackURL
    if (callbackURL === undefined) {
      textResponse(response, 503, 'Login callback is not ready')
      callbackInFlight = false
      return
    }
    const apiKey = await exchangeCode(parsedOrigin, callbackURL, code, codeVerifier, fetchImpl, abortController.signal)
    if (apiKey === undefined) {
      textResponse(response, 502, 'Tako login could not be completed. Return to DSH and try again.')
      finish({ ok: false, reason: 'failed' })
      return
    }
    textResponse(response, 200, 'Tako login completed. Return to the DSH window.')
    finish({ ok: true, apiKey })
  }
  const server = createServer((request, response) => {
    void handleCallback(request, response).catch(() => {
      callbackInFlight = false
      if (!response.headersSent) textResponse(response, 500, 'Login callback failed')
    })
  })
  handles.server = server
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => { server.off('listening', onListening); reject(error) }
    const onListening = (): void => { server.off('error', onError); resolve() }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(0, '127.0.0.1')
  }).catch((error: unknown) => {
    closeServer(handles.server)
    throw new Error(`tako login: could not open callback listener (${error instanceof Error ? error.message : 'unknown error'})`)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    closeServer(handles.server)
    throw new Error('tako login: callback listener did not expose a port')
  }
  handles.timer = setTimeout(() => { finish({ ok: false, reason: 'expired' }) }, timeoutMs)
  const callbackURL = `http://127.0.0.1:${String(address.port)}${CALLBACK_PATH}`
  handles.callbackURL = callbackURL
  const authorize = new URL('/app/authorize', parsedOrigin)
  authorize.searchParams.set('client_id', CLIENT_ID)
  authorize.searchParams.set('response_type', 'code')
  authorize.searchParams.set('redirect_uri', callbackURL)
  authorize.searchParams.set('state', state)
  authorize.searchParams.set('code_challenge', codeChallenge)
  authorize.searchParams.set('code_challenge_method', 'S256')
  authorize.searchParams.set('device_name', deviceName)
  return {
    authorizeUrl: authorize.href,
    wait,
    cancel: () => { finish({ ok: false, reason: 'cancelled' }) },
  }
}
