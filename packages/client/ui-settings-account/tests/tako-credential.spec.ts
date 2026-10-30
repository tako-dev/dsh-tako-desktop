import { expect, it } from 'vitest'
import { TAKO_CREDENTIAL_REF, takoCredentialConfigured } from '../src/client/tako-credential.ts'

it('reads only a successful describe of the shared Tako key', () => {
  expect(takoCredentialConfigured(undefined)).toBe(false)
  expect(takoCredentialConfigured({ ok: false, value: { [TAKO_CREDENTIAL_REF]: { configured: true } } })).toBe(false)
  expect(takoCredentialConfigured({ ok: true, value: {} })).toBe(false)
  expect(takoCredentialConfigured({ ok: true, value: { [TAKO_CREDENTIAL_REF]: { configured: false } } })).toBe(false)
  expect(takoCredentialConfigured({ ok: true, value: { [TAKO_CREDENTIAL_REF]: { configured: true } } })).toBe(true)
})
