import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { defaultTakoDeviceName, startTakoBrowserLogin, takoHostLabel } from '../src/tako-login.ts'

function parseCallback(handle: Awaited<ReturnType<typeof startTakoBrowserLogin>>): URL {
  const authorize = new URL(handle.authorizeUrl)
  const callback = authorize.searchParams.get('redirect_uri')
  if (callback === null) throw new Error('missing callback URL')
  return new URL(callback)
}

describe('Tako browser login callback', () => {
  it('opens the PKCE authorization page and exchanges one callback code for a key', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      expect(input instanceof URL ? input.href : input).toBe('https://tako.example.test/api/desktop/token')
      expect(init?.method).toBe('POST')
      expect(init?.headers).toEqual({ 'content-type': 'application/json' })
      const payload = JSON.parse(init?.body as string) as Record<string, string>
      expect(payload.grant_type).toBe('authorization_code')
      expect(payload.client_id).toBe('dsh-desktop')
      expect(payload.code).toBe('test-code')
      expect(payload.redirect_uri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/tako\/callback$/)
      expect(payload.code_verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
      return new Response(JSON.stringify({ success: true, data: { key: 'tako-test-key' } }), { status: 200 })
    })
    const handle = await startTakoBrowserLogin({ websiteOrigin: 'https://tako.example.test', fetchImpl, deviceName: 'DSH@test' })
    const authorize = new URL(handle.authorizeUrl)
    expect(authorize.origin).toBe('https://tako.example.test')
    expect(authorize.pathname).toBe('/app/authorize')
    expect(authorize.searchParams.get('client_id')).toBe('dsh-desktop')
    expect(authorize.searchParams.get('response_type')).toBe('code')
    expect(authorize.searchParams.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/tako\/callback$/)
    expect(authorize.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(authorize.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256')
    expect(authorize.searchParams.get('device_name')).toBe('DSH@test')
    expect(authorize.href).not.toContain('apiKey')

    const callback = parseCallback(handle)
    callback.searchParams.set('state', authorize.searchParams.get('state')!)
    callback.searchParams.set('code', 'test-code')
    const response = await fetch(callback)
    expect(response.status).toBe(200)
    await expect(handle.wait).resolves.toEqual({ ok: true, apiKey: 'tako-test-key' })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('rejects a wrong state and lets the user cancel the pending handoff', async () => {
    const handle = await startTakoBrowserLogin({ websiteOrigin: 'https://tako.example.test' })
    const callback = parseCallback(handle)
    callback.searchParams.set('state', 'wrong')
    callback.searchParams.set('code', 'test-code')
    const response = await fetch(callback)
    expect(response.status).toBe(400)
    handle.cancel()
    await expect(handle.wait).resolves.toEqual({ ok: false, reason: 'cancelled' })
  })

  it('finishes with failure when the provider returns an authorization error', async () => {
    const handle = await startTakoBrowserLogin({ websiteOrigin: 'https://tako.example.test' })
    const authorize = new URL(handle.authorizeUrl)
    const callback = parseCallback(handle)
    callback.searchParams.set('state', authorize.searchParams.get('state')!)
    callback.searchParams.set('error', 'access_denied')
    const response = await fetch(callback)
    expect(response.status).toBe(400)
    await expect(handle.wait).resolves.toEqual({ ok: false, reason: 'failed' })
  })

  it('expires a callback listener without exposing an API key', async () => {
    const handle = await startTakoBrowserLogin({ websiteOrigin: 'https://tako.example.test', timeoutMs: 10 })
    await expect(handle.wait).resolves.toEqual({ ok: false, reason: 'expired' })
  })

  it('computes the standard S256 challenge from the verifier sent to Tako', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      const payload = JSON.parse(init?.body as string) as Record<string, string>
      const verifier = payload.code_verifier
      if (verifier === undefined) throw new Error('missing code verifier')
      const expected = createHash('sha256').update(verifier).digest('base64url')
      expect(expected).toMatch(/^[A-Za-z0-9_-]{43}$/)
      return new Response(JSON.stringify({ success: true, data: { key: 'tako-test-key' } }), { status: 200 })
    })
    const handle = await startTakoBrowserLogin({ websiteOrigin: 'https://tako.example.test', fetchImpl })
    const authorize = new URL(handle.authorizeUrl)
    const callback = parseCallback(handle)
    callback.searchParams.set('state', authorize.searchParams.get('state')!)
    callback.searchParams.set('code', 'test-code')
    await fetch(callback)
    await expect(handle.wait).resolves.toMatchObject({ ok: true })
    const body = fetchImpl.mock.calls[0]?.[1]?.body
    expect(typeof body).toBe('string')
    const payload = JSON.parse(body as string) as Record<string, string>
    const challenge = authorize.searchParams.get('code_challenge')
    if (challenge === null) throw new Error('missing code challenge')
    const verifier = payload.code_verifier
    if (verifier === undefined) throw new Error('missing code verifier')
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'))
  })
})

describe('Tako device name', () => {
  it('names the machine by its first host label', () => {
    expect(defaultTakoDeviceName('Studio.local', 'darwin')).toBe('DSH-Tako@Studio')
    expect(defaultTakoDeviceName('build-01.corp.example.com', 'linux')).toBe('DSH-Tako@build-01')
    expect(defaultTakoDeviceName('DESKTOP-AB12CD', 'win32')).toBe('DSH-Tako@DESKTOP-AB12CD')
  })

  it('replaces spaces and non-ASCII characters and trims edge punctuation', () => {
    expect(takoHostLabel('  My  MacBook Pro  ')).toBe('My-MacBook-Pro')
    expect(defaultTakoDeviceName('张三的 MacBook.local', 'darwin')).toBe('DSH-Tako@MacBook')
    expect(defaultTakoDeviceName('--_host+_--', 'darwin')).toBe('DSH-Tako@host')
  })

  it('caps the name at 32 characters without trailing punctuation', () => {
    const name = defaultTakoDeviceName('a-very-long-workstation-name-x-y-z-and-more', 'linux')
    expect(name).toBe('DSH-Tako@a-very-long-workstation')
    expect(name.length).toBeLessThanOrEqual(32)
    expect(defaultTakoDeviceName('abcdefghijklmnopqrstuvw-xyz', 'linux')).toBe('DSH-Tako@abcdefghijklmnopqrstuvw')
  })

  it('falls back to the platform when the host name yields nothing', () => {
    expect(defaultTakoDeviceName('', 'darwin')).toBe('DSH-Tako@darwin')
    expect(defaultTakoDeviceName('电脑.local', 'win32')).toBe('DSH-Tako@win32')
    expect(defaultTakoDeviceName('.local', 'linux')).toBe('DSH-Tako@linux')
  })

  it('sends the default device name when the caller supplies none', async () => {
    const handle = await startTakoBrowserLogin({ websiteOrigin: 'https://tako.example.test', fetchImpl: vi.fn<typeof fetch>() })
    try {
      expect(new URL(handle.authorizeUrl).searchParams.get('device_name')).toBe(defaultTakoDeviceName())
    } finally { handle.cancel() }
    await handle.wait
  })
})
