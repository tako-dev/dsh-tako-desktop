/** Retry Apple's CloudKit-backed ticket delivery without resubmitting accepted artifacts. */

import { spawnSync } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_STAPLE_ATTEMPTS,
  DEFAULT_STAPLE_BACKOFF_MS,
  MAX_STAPLE_BACKOFF_MS,
  isStapleFailure,
  isStapleNetworkFailure,
  resolveStapleRetryPolicy,
  retryStapleOperation,
  retryStapleOperationAsync,
  stapleRetryDelay,
} from '../scripts/macos-staple-retry.mjs'
import { notarizeMacOS, stapleMacOSArtifact } from '../scripts/notarize-macos.mjs'
import { validateStapledTicket, verifyMacOSDiskImage, verifyMacOSNotarizedApplication } from '../scripts/verify-macos-signature.mjs'

vi.mock('node:child_process', async importOriginal => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  spawnSync: vi.fn(),
}))

const policy = { attempts: 3, backoffMs: 100, maxBackoffMs: 1_000 }
const expected = { signingIdentity: 'Example Company (TEAMID1234)', teamId: 'TEAMID1234' }
const signatureDetails = `Authority=Developer ID Application: ${expected.signingIdentity}\nTeamIdentifier=${expected.teamId}`

beforeEach(() => {
  // Retry diagnostics belong to CI logs; keep the suite quiet without hiding a thrown failure.
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.resetAllMocks()
})

describe('staple retry policy', () => {
  it('defaults to five attempts with 15s exponential backoff capped at 120s', () => {
    expect(DEFAULT_STAPLE_ATTEMPTS).toBe(5)
    expect(DEFAULT_STAPLE_BACKOFF_MS).toBe(15_000)
    expect(MAX_STAPLE_BACKOFF_MS).toBe(120_000)
    expect(resolveStapleRetryPolicy({})).toEqual({ attempts: 5, backoffMs: 15_000, maxBackoffMs: 120_000 })
    expect(resolveStapleRetryPolicy({ DSH_DESKTOP_STAPLE_ATTEMPTS: ' ', DSH_DESKTOP_STAPLE_BACKOFF_MS: '' }))
      .toEqual({ attempts: 5, backoffMs: 15_000, maxBackoffMs: 120_000 })
  })

  it('reads attempts and backoff from the packaging environment', () => {
    expect(resolveStapleRetryPolicy({ DSH_DESKTOP_STAPLE_ATTEMPTS: '7', DSH_DESKTOP_STAPLE_BACKOFF_MS: '250' }))
      .toEqual({ attempts: 7, backoffMs: 250, maxBackoffMs: 120_000 })
  })

  it('rejects values that would silently disable retries', () => {
    expect(() => resolveStapleRetryPolicy({ DSH_DESKTOP_STAPLE_ATTEMPTS: '0' })).toThrow(/DSH_DESKTOP_STAPLE_ATTEMPTS must be at least 1/u)
    expect(() => resolveStapleRetryPolicy({ DSH_DESKTOP_STAPLE_ATTEMPTS: 'many' })).toThrow(/must be an integer/u)
    expect(() => resolveStapleRetryPolicy({ DSH_DESKTOP_STAPLE_BACKOFF_MS: '-1' })).toThrow(/must be an integer/u)
    expect(() => resolveStapleRetryPolicy({ DSH_DESKTOP_STAPLE_BACKOFF_MS: '1.5' })).toThrow(/must be an integer/u)
  })

  it('doubles the delay and caps it at 120s', () => {
    const budget = { attempts: 5, backoffMs: 15_000, maxBackoffMs: 120_000 }
    expect([1, 2, 3, 4, 5].map(retry => stapleRetryDelay(budget, retry))).toEqual([15_000, 30_000, 60_000, 120_000, 120_000])
    expect(stapleRetryDelay({ backoffMs: 0, maxBackoffMs: 120_000 }, 1)).toBe(0)
  })
})

describe('staple failure classification', () => {
  it('recognizes CloudKit and NSURLErrorDomain transport failures', () => {
    expect(isStapleNetworkFailure(new Error('CloudKit query failed'))).toBe(true)
    expect(isStapleNetworkFailure(new Error('NSURLErrorDomain -1005'))).toBe(true)
    expect(isStapleNetworkFailure(new Error('wrapper', { cause: new Error('The network connection was lost') }))).toBe(true)
    expect(isStapleNetworkFailure('connection reset by peer')).toBe(true)
  })

  it('does not treat a missing ticket as a network failure', () => {
    expect(isStapleNetworkFailure(new Error('The staple and validate action failed! Error 65.'))).toBe(false)
    expect(isStapleNetworkFailure(new Error('notarytool submit failed: HTTP 401'))).toBe(false)
    expect(isStapleNetworkFailure(new Error('CloudKit query failed: <CKError 0x1: "Record not found">'))).toBe(false)
  })

  it('recognizes the electron-notarize staple failure without matching submission failures', () => {
    expect(isStapleFailure(new Error('Failed to staple your application with code: 68'))).toBe(true)
    expect(isStapleFailure(new Error('ticket delivery failed: code: 68'))).toBe(true)
    expect(isStapleFailure(new Error('api.apple-cloudkit.com ticket-delivery reset'))).toBe(true)
    expect(isStapleFailure(new Error('notarytool submit failed: HTTP 401'))).toBe(false)
  })
})

describe('retried ticket validation', () => {
  it('retries after a CloudKit reset and succeeds', () => {
    const sleep = vi.fn()
    const execute = vi.fn(() => { if (execute.mock.calls.length < 3) throw new Error('CloudKit query failed: NSURLErrorDomain -1005') })
    expect(() => { validateStapledTicket('/tmp/DSH Tako.app', { policy, execute, sleep }) }).not.toThrow()
    expect(execute).toHaveBeenCalledTimes(3)
    expect(execute).toHaveBeenNthCalledWith(1, '/tmp/DSH Tako.app')
    expect(sleep.mock.calls).toEqual([[100], [200]])
  })

  it('fails after the configured attempts and names the count', () => {
    const failure = new Error('CloudKit query failed: NSURLErrorDomain -1005')
    const sleep = vi.fn()
    const execute = vi.fn(() => { throw failure })
    let thrown: unknown
    try { validateStapledTicket('/tmp/release.dmg', { policy, execute, sleep }) }
    catch (error) { thrown = error }
    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message).toContain('still failed after 3 attempts')
    expect((thrown as Error).cause).toBe(failure)
    expect(execute).toHaveBeenCalledTimes(3)
    expect(sleep.mock.calls).toEqual([[100], [200]])
  })

  it('does not retry a missing ticket', () => {
    const sleep = vi.fn()
    const execute = vi.fn(() => { throw new Error('The staple and validate action failed! Error 65.') })
    expect(() => { validateStapledTicket('/tmp/DSH Tako.app', { policy, execute, sleep }) })
      .toThrow(/The staple and validate action failed!/u)
    expect(execute).toHaveBeenCalledOnce()
    expect(sleep).not.toHaveBeenCalled()
  })
})

describe('retried stapling', () => {
  it.each(['/tmp/DSH Tako.app', '/tmp/DSH-Tako-0.1.1-mac-arm64.dmg'])('retries %s after a CloudKit reset', async (appPath) => {
    const sleep = vi.fn()
    const execute = vi.fn(async () => { if (execute.mock.calls.length < 3) throw new Error('api.apple-cloudkit.com/.../ticket-delivery reset (-1005)') })
    await expect(stapleMacOSArtifact(appPath, { policy, execute, sleep })).resolves.toBeUndefined()
    expect(execute).toHaveBeenCalledTimes(3)
    expect(execute).toHaveBeenNthCalledWith(1, appPath)
    expect(sleep.mock.calls).toEqual([[100], [200]])
  })

  it('fails after the configured attempts and preserves the original error', async () => {
    const failure = new Error('CloudKit ticket delivery failed: -1005')
    const execute = vi.fn(async () => { throw failure })
    const error = await stapleMacOSArtifact('/tmp/DSH Tako.app', { policy, execute, sleep: vi.fn(async () => {}) })
      .catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain('still failed after 3 attempts')
    expect((error as Error).cause).toBe(failure)
    expect(execute).toHaveBeenCalledTimes(3)
  })

  it('stops immediately on a non-staple failure', async () => {
    const sleep = vi.fn(async () => {})
    const execute = vi.fn(async () => { throw new Error('codesign rejected the artifact') })
    await expect(stapleMacOSArtifact('/tmp/DSH Tako.app', { policy, execute, sleep })).rejects.toThrow(/codesign rejected/u)
    expect(execute).toHaveBeenCalledOnce()
    expect(sleep).not.toHaveBeenCalled()
  })
})

describe('generic retry loops', () => {
  it('returns the first synchronous success without waiting', () => {
    const sleep = vi.fn()
    expect(retryStapleOperation(() => 'accepted', { policy, sleep })).toBe('accepted')
    expect(sleep).not.toHaveBeenCalled()
  })

  it('awaits the asynchronous operation and its backoff', async () => {
    const sleep = vi.fn(async () => {})
    let calls = 0
    await expect(retryStapleOperationAsync(async () => {
      calls += 1
      if (calls === 1) throw new Error('NSURLErrorDomain -1005')
      return 'accepted'
    }, { policy, sleep })).resolves.toBe('accepted')
    expect(sleep.mock.calls).toEqual([[100]])
  })
})

describe('notarize without resubmission', () => {
  it('staples again when electron-notarize fails while stapling', async () => {
    const submit = vi.fn(async (_options: object) => { throw new Error('Failed to staple your application with code: 68\n\napi.apple-cloudkit.com -1005') })
    const staple = vi.fn(async () => {})
    await notarizeMacOS({ appPath: '/tmp/DSH Tako.app', keychainProfile: 'fixture' }, { environment: {}, submit, staple })
    expect(submit).toHaveBeenCalledOnce()
    expect(submit.mock.calls[0]![0]).toMatchObject({ appPath: '/tmp/DSH Tako.app', keychainProfile: 'fixture' })
    expect(staple).toHaveBeenCalledOnce()
    expect(staple).toHaveBeenCalledWith('/tmp/DSH Tako.app', {
      policy: { attempts: 5, backoffMs: 15_000, maxBackoffMs: 120_000 }, environment: {},
    })
  })

  it('does not staple when notarization itself failed', async () => {
    const submit = vi.fn(async () => { throw new Error('notarytool submit failed: HTTP 401') })
    const staple = vi.fn(async () => {})
    await expect(notarizeMacOS({ appPath: '/tmp/DSH Tako.app', keychainProfile: 'fixture' }, { environment: {}, submit, staple }))
      .rejects.toThrow(/HTTP 401/u)
    expect(staple).not.toHaveBeenCalled()
  })

  it('does not staple a successful notarization twice', async () => {
    const submit = vi.fn(async () => {})
    const staple = vi.fn(async () => {})
    await expect(notarizeMacOS({ appPath: '/tmp/DSH Tako.app', keychainProfile: 'fixture' }, { environment: {}, submit, staple }))
      .resolves.toBeUndefined()
    expect(staple).not.toHaveBeenCalled()
  })
})

describe('release verification integration', () => {
  function toolResult(status = 0, stderr = signatureDetails) {
    return { pid: 1, output: [], stdout: '', stderr, status, signal: null }
  }

  it('retries stapler validate in both release checks before accepting the artifacts', () => {
    vi.stubEnv('DSH_DESKTOP_STAPLE_BACKOFF_MS', '0')
    let validations = 0
    vi.mocked(spawnSync).mockImplementation((command) => {
      if (command === '/usr/bin/xcrun') {
        validations += 1
        if (validations === 1) return toolResult(65, 'CloudKit query failed: NSURLErrorDomain -1005')
      }
      return toolResult()
    })
    expect(() => { verifyMacOSNotarizedApplication('/tmp/DSH Tako.app', expected) }).not.toThrow()
    expect(validations).toBe(2)
    validations = 0
    expect(() => { verifyMacOSDiskImage('/tmp/release.dmg', expected) }).not.toThrow()
    expect(validations).toBe(2)
  })

  it('rejects a missing ticket on the first validation attempt', () => {
    vi.stubEnv('DSH_DESKTOP_STAPLE_BACKOFF_MS', '0')
    let validations = 0
    vi.mocked(spawnSync).mockImplementation((command) => {
      if (command === '/usr/bin/xcrun') {
        validations += 1
        return toolResult(65, 'The staple and validate action failed! Error 65.')
      }
      return toolResult()
    })
    expect(() => { verifyMacOSNotarizedApplication('/tmp/DSH Tako.app', expected) }).toThrow(/Error 65/u)
    expect(validations).toBe(1)
  })
})
