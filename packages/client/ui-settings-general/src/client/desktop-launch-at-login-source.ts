/** Shell-owned login-item state shared by the General settings row. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { DesktopLaunchAtLoginBridge, DesktopLaunchAtLoginChangeResult, DesktopLaunchAtLoginState } from '../types.ts'

/** Actual shell registration, an optimistic toggle and a failed read or write. */
export interface DesktopLaunchAtLoginSnapshot {
  state?: DesktopLaunchAtLoginState
  failed: boolean
  pending?: boolean
}

/** Client observation; no Host service or OS API is read here. */
export class DesktopLaunchAtLoginSource {
  /** Stable observation shared by mounted General views. */
  readonly store = createSnapshotStore<DesktopLaunchAtLoginSnapshot>({ failed: false })
  private live = true
  private settled = false

  /** @param bridge - Isolated shell API, present only in Desktop. */
  constructor(private readonly bridge: DesktopLaunchAtLoginBridge) {
    void bridge.get().then((state) => {
      if (this.live && !this.settled) {
        this.settled = true
        this.store.set({ ...this.store.getSnapshot(), state, failed: false })
      }
    }, () => {
      if (this.live && !this.settled) {
        this.settled = true
        this.store.set({ ...this.store.getSnapshot(), failed: true })
      }
    })
  }

  /**
   * Show a pending choice until the shell confirms the registration outcome.
   * A cancelled native confirmation restores the displayed state without an error.
   * @param open - Requested login-item state.
   * @returns After the shell reports the result.
   */
  async select(open: boolean): Promise<void> {
    if (!this.isLive()) return
    const snapshot = this.store.getSnapshot()
    if (snapshot.pending !== undefined || snapshot.state === undefined) return
    if (snapshot.state.enabled === open) return
    this.store.set({ ...snapshot, pending: open, failed: false })
    let result: DesktopLaunchAtLoginChangeResult | undefined
    try {
      result = await this.bridge.set(open)
    } catch (_error) {
      // An IPC failure has no reliable user-facing detail or confirmed new state.
    }
    if (!this.isLive()) return
    this.settled = true
    const { pending: _pending, ...current } = this.store.getSnapshot()
    this.store.set({
      ...current,
      ...(result?.kind === 'applied' ? { state: { supported: current.state?.supported ?? true, enabled: result.enabled }, failed: false } : {}),
      ...(result === undefined ? { failed: true } : {}),
    })
  }

  private isLive(): boolean { return this.live }

  /** Ignore late IPC responses. */
  dispose(): void { this.live = false }
}
