import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { startTakoBrowserLogin } from '../src/tako-login.ts'

function parseCallback(handle: Awaited<ReturnType<typeof startTakoBrowserLogin>>): URL {
  const authorize = new URL(handle.authorizeUrl)
  const callback = authorize.searchParams.get('redirect_uri')
  if (callback === null) throw new Error('missing callback URL')
  return new URL(callback)
}

describe('Tako browser login callback', () => {
  it('opens the PKCE authorization page and exchanges one callback code for a key', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe('https://tako.example.test/api/desktop/token')
      expect(init?.method).toBe('POST')
      expect(init?.headers).toEqual({ 'content-type': 'application/json' })
      const payload = JSON.parse(String(init?.body)) as Record<string, string>
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
      const payload = JSON.parse(String(init?.body)) as Record<string, string>
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
    const payload = JSON.parse(String(body)) as Record<string, string>
    const challenge = authorize.searchParams.get('code_challenge')
    if (challenge === null) throw new Error('missing code challenge')
    const verifier = payload.code_verifier
    if (verifier === undefined) throw new Error('missing code verifier')
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'))
  })
})
