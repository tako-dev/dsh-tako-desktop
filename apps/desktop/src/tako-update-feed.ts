/** Runtime GitHub → Tako generic feed fallback for in-app desktop auto-update. */

const NETWORK_CODES = new Set([
  'ETIMEDOUT',
  'ENOTFOUND',
  'ECONNRESET',
  'ECONNREFUSED',
  'ENETUNREACH',
  'EAI_AGAIN',
])

const GITHUB_HTTP_STATUSES = new Set([403, 404, 429, 502, 503])

const MIRROR_URL_ENV = 'DSH_TAKO_UPDATE_MIRROR_URL'

/** Generic electron-updater feed mirrored from GitHub Releases; trailing slash is required. */
export const TAKO_DESKTOP_UPDATE_MIRROR_URL = 'https://tako.shiroha.tech/dsh/updates/'

function withTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//iu.test(value)
}

/**
 * Resolve the generic feed used when GitHub Releases cannot be reached.
 * @param env - Process environment; `DSH_TAKO_UPDATE_MIRROR_URL` overrides the default when it is an http(s) URL.
 * @returns Absolute generic feed URL with a trailing slash.
 */
export function resolveTakoDesktopUpdateMirrorUrl(env: NodeJS.ProcessEnv = process.env): string {
  const requested = env[MIRROR_URL_ENV]?.trim()
  if (requested === undefined || requested === '' || !isHttpUrl(requested)) {
    return TAKO_DESKTOP_UPDATE_MIRROR_URL
  }
  return withTrailingSlash(requested)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function errorMessage(error: unknown): string {
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message
  return String(error)
}

function stringField(error: unknown, name: string): string | undefined {
  if (!isRecord(error)) return undefined
  const value = error[name]
  return typeof value === 'string' ? value : undefined
}

function numberField(error: unknown, name: string): number | undefined {
  if (!isRecord(error)) return undefined
  const value = error[name]
  return typeof value === 'number' ? value : undefined
}

function causeOf(error: unknown): unknown {
  if (!isRecord(error) || !('cause' in error)) return undefined
  return error.cause
}

function walk(error: unknown): unknown[] {
  const items: unknown[] = []
  const seen = new Set<unknown>()
  let current: unknown = error
  while (current !== undefined && current !== null && !seen.has(current)) {
    seen.add(current)
    items.push(current)
    current = causeOf(current)
  }
  return items
}

function httpStatus(error: unknown, text: string): number | undefined {
  const statusCode = numberField(error, 'statusCode')
  if (statusCode !== undefined) return statusCode
  const code = stringField(error, 'code')
  const fromCode = code === undefined ? undefined : /^HTTP_ERROR_(\d{3})$/u.exec(code)
  if (fromCode?.[1] !== undefined) return Number(fromCode[1])
  const fromText = /(?:status code |HttpError:\s*)(\d{3})/iu.exec(text)
  return fromText?.[1] === undefined ? undefined : Number(fromText[1])
}

/**
 * Whether a check or download failure means the packaged GitHub Releases feed could not be reached.
 * @param error - Rejection from electron-updater or the Node/Electron HTTP stack.
 * @returns True for transport, DNS, timeout, and GitHub HTTP failures; false for already-latest and invalid versions.
 */
export function githubFeedUnreachable(error: unknown): boolean {
  const items = walk(error)
  const combined = items.map(errorMessage).join('\n')
  const lower = combined.toLowerCase()
  if (combined.includes('net::ERR_') || lower.includes('getaddrinfo') || lower.includes('timed out')) {
    return true
  }
  const github = lower.includes('github')
  if (github && (lower.includes('cannot find channel') || lower.includes('unable to find latest'))) {
    return true
  }
  for (const item of items) {
    const code = stringField(item, 'code')
    if (code !== undefined && NETWORK_CODES.has(code)) return true
    if (NETWORK_CODES.has(errorMessage(item))) return true
    const status = httpStatus(item, errorMessage(item))
    if (github && status !== undefined && GITHUB_HTTP_STATUSES.has(status)) return true
  }
  return false
}
