/** Lease-scoped browser operations and one main-process event subscription per window. */
import { ipcRenderer } from 'electron'
import type { DesktopBrowserBridge, DesktopBrowserLeaseId } from '@deepseek-ai/dsh-client-ui-sidebar-browser/types'
import { DESKTOP_IPC } from './ipc.ts'

/** @returns browser operations that expose neither IPC nor Electron objects. */
export function createDesktopBrowserBridge(): DesktopBrowserBridge {
  const listeners = new Map<DesktopBrowserLeaseId, Set<(url: string) => void>>()
  const sharing = new Map<DesktopBrowserLeaseId, Set<(shared: boolean) => void>>()
  ipcRenderer.on(DESKTOP_IPC.browserSharingChanged, (_event, request: unknown) => {
    if (typeof request !== 'object' || request === null || !('lease' in request) || !('shared' in request)
      || typeof request.lease !== 'string' || typeof request.shared !== 'boolean') return
    for (const listener of sharing.get(request.lease as DesktopBrowserLeaseId) ?? []) {
      try { listener(request.shared) }
      catch (error) { console.error('Desktop browser sharing listener failed', error) }
    }
  })
  ipcRenderer.on(DESKTOP_IPC.browserOpenRequested, (_event, request: unknown) => {
    if (typeof request !== 'object' || request === null || !('lease' in request) || !('url' in request)
      || typeof request.lease !== 'string' || typeof request.url !== 'string') return
    const callbacks = listeners.get(request.lease as DesktopBrowserLeaseId)
    if (callbacks === undefined) return
    for (const callback of [...callbacks]) {
      try { callback(request.url) }
      catch (error) { console.error('Desktop browser link handler failed', error) }
    }
  })
  return {
    acquire: (workspace, sessionId) => ipcRenderer.invoke(DESKTOP_IPC.browserAcquire, workspace, sessionId) as ReturnType<DesktopBrowserBridge['acquire']>,
    release: lease => ipcRenderer.invoke(DESKTOP_IPC.browserRelease, lease) as Promise<void>,
    setShared: (lease, shared) => ipcRenderer.invoke(DESKTOP_IPC.browserSetShared, lease, shared) as Promise<void>,
    onSharingChanged(lease, listener) {
      let callbacks = sharing.get(lease)
      if (callbacks === undefined) { callbacks = new Set(); sharing.set(lease, callbacks) }
      callbacks.add(listener)
      return () => {
        callbacks.delete(listener)
        if (callbacks.size === 0 && sharing.get(lease) === callbacks) sharing.delete(lease)
      }
    },
    onOpenRequested(lease, listener) {
      let callbacks = listeners.get(lease)
      if (callbacks === undefined) { callbacks = new Set(); listeners.set(lease, callbacks) }
      callbacks.add(listener)
      return () => {
        callbacks.delete(listener)
        if (callbacks.size === 0 && listeners.get(lease) === callbacks) listeners.delete(lease)
      }
    },
  }
}
