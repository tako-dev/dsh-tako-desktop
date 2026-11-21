// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { applyIndexInjections } from '../src/apply-injections.ts'

const loadScript = vi.fn(async (_src: string) => {})

afterEach(() => {
  delete (globalThis as Record<string, unknown>).INJECTION_FRESH
})

/** A contextBridge-style frozen global; once set the name stays for the file's lifetime. */
function freeze(name: string, value: unknown): void {
  Object.defineProperty(globalThis, name, { value, writable: false, configurable: false })
}

it('assigns a fresh global row before later rows read it', async () => {
  await applyIndexInjections([{ kind: 'global', name: 'INJECTION_FRESH', value: 7 }], loadScript)
  expect((globalThis as Record<string, unknown>).INJECTION_FRESH).toBe(7)
})

it('reuses a read-only global carrying the same value instead of throwing', async () => {
  // contextBridge.exposeInMainWorld installs a non-writable, non-configurable
  // data property; the desktop preload owns __DSH_TAKO_PROFILE__ this way.
  freeze('INJECTION_FROZEN_SAME', true)
  await expect(applyIndexInjections([{ kind: 'global', name: 'INJECTION_FROZEN_SAME', value: true }], loadScript))
    .resolves.toBeUndefined()
})

it('rejects a read-only global carrying a different value', async () => {
  freeze('INJECTION_FROZEN_OTHER', 'first')
  await expect(applyIndexInjections([{ kind: 'global', name: 'INJECTION_FROZEN_OTHER', value: 'second' }], loadScript))
    .rejects.toThrow('"INJECTION_FROZEN_OTHER" conflicts with a read-only global')
})

it('keeps executing rows after a matching frozen global', async () => {
  freeze('INJECTION_FROZEN_NEXT', true)
  await applyIndexInjections([
    { kind: 'global', name: 'INJECTION_FROZEN_NEXT', value: true },
    { kind: 'global', name: 'INJECTION_FRESH', value: 1 },
  ], loadScript)
  expect((globalThis as Record<string, unknown>).INJECTION_FRESH).toBe(1)
})
