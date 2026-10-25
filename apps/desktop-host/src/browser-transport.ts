/** Correlated private IPC for the shell-owned shared browser. */
import type { DesktopBrowserAction, DesktopBrowserResult } from '@deepseek-ai/dsh-client-ui-sidebar-browser/types'

/** Transport injection used by the Host and its composition tests. */
export interface BrowserTransport {
  /** @param sessionId - executing chat. @param action - bounded operation. @param signal - tool lifetime. @returns shell result. */
  run(sessionId: string, action: DesktopBrowserAction, signal: AbortSignal): Promise<DesktopBrowserResult>
  /** Remove IPC listeners and settle pending calls before Host teardown. */
  dispose(): void
}

/** @returns a transport using the current child-process IPC channel, without opening a network listener. */
export function createBrowserTransport(): BrowserTransport {
  let sequence = 0
  let disposed = false
  const pending = new Map<number, { resolve(value: DesktopBrowserResult): void; reject(error: Error): void }>()
  const message = (value: unknown): void => {
    if (typeof value !== 'object' || value === null || !('type' in value) || value.type !== 'browser-result'
      || !('requestId' in value) || typeof value.requestId !== 'number') return
    const request = pending.get(value.requestId)
    if (request === undefined) return
    if ('error' in value && typeof value.error === 'string') { request.reject(new Error(value.error)); return }
    if (!('result' in value) || typeof value.result !== 'object' || value.result === null
      || !('shared' in value.result) || typeof value.result.shared !== 'boolean'
      || !('text' in value.result) || typeof value.result.text !== 'string' || value.result.text.length > 40_000
      || ('image' in value.result && (typeof value.result.image !== 'string' || value.result.image.length > 8 * 1024 * 1024))) {
      request.reject(new Error('Invalid Desktop browser response.')); return
    }
    request.resolve(value.result as DesktopBrowserResult)
  }
  const dispose = (): void => {
    disposed = true
    process.off('message', message)
    process.off('disconnect', dispose)
    for (const request of pending.values()) request.reject(new Error('Desktop browser disconnected.'))
    pending.clear()
  }
  process.on('message', message)
  process.once('disconnect', dispose)
  return {
    dispose,
    async run(sessionId, action, signal) {
      signal.throwIfAborted()
      if (disposed || !process.connected || process.send === undefined) throw new Error('Desktop browser is unavailable.')
      const id = ++sequence
      const combined = AbortSignal.any([signal, AbortSignal.timeout(20_000)])
      let abort: (() => void) | undefined
      try {
        return await new Promise<DesktopBrowserResult>((resolve, reject) => {
          pending.set(id, { resolve, reject })
          abort = () => {
            if (process.connected) process.send?.({ type: 'browser-cancel', requestId: id }, error => {
              if (error !== null) console.error('Desktop browser cancellation transport failed', error)
            })
            reject(new Error('Browser action interrupted; inspect the page before retrying.'))
          }
          combined.addEventListener('abort', abort, { once: true })
          process.send?.({ type: 'browser-action', requestId: id, sessionId, action }, error => { if (error !== null) reject(error) })
        })
      } finally {
        pending.delete(id)
        if (abort !== undefined) combined.removeEventListener('abort', abort)
      }
    },
  }
}
