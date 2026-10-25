/** Type-only Electron bridge declarations shared by the desktop shell and browser provider. */
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Main-issued identity of one guest reservation. */
export type DesktopBrowserLeaseId = Branded<'DesktopBrowserLeaseId'>

/** A guest's approved, process-local storage partition. */
export interface DesktopBrowserReservation {
  readonly lease: DesktopBrowserLeaseId
  readonly partition: string
}

/** Main-approved request to open an HTTP(S) page from an existing guest. */
export interface DesktopBrowserOpenRequest {
  readonly lease: DesktopBrowserLeaseId
  readonly url: string
}

/** Origin-scoped operations; no Electron objects or arbitrary IPC cross this interface. */
export interface DesktopBrowserBridge {
  /** @param workspace - resolved storage account. @param sessionId - owning DSH chat. @returns one approved guest reservation. */
  acquire(workspace: string, sessionId: string): Promise<DesktopBrowserReservation>
  /** @param lease - the caller's reservation. @returns after its guest has been destroyed. */
  release(lease: DesktopBrowserLeaseId): Promise<void>
  /** @param lease - originating guest. @param listener - approved URL consumer. @returns unsubscribe callback. */
  onOpenRequested(lease: DesktopBrowserLeaseId, listener: (url: string) => void): () => void
  /** @param lease - caller-owned tab. @param shared - grant or revoke access for its owning chat. */
  setShared(lease: DesktopBrowserLeaseId, shared: boolean): Promise<void>
  /** @param lease - caller-owned tab. @param listener - committed sharing state. @returns unsubscribe callback. */
  onSharingChanged(lease: DesktopBrowserLeaseId, listener: (shared: boolean) => void): () => void
}

/** Page operations carried privately between the Desktop Host and Electron. */
export interface DesktopBrowserAction {
  readonly action: 'status' | 'snapshot' | 'evaluate' | 'navigate' | 'click' | 'type' | 'press' | 'scroll' | 'screenshot'
  readonly value?: string
  readonly x?: number
  readonly y?: number
}

/** Bounded result from the selected live tab; screenshots become durable Host attachments. */
export interface DesktopBrowserResult {
  readonly shared: boolean
  readonly text: string
  readonly image?: string
}
