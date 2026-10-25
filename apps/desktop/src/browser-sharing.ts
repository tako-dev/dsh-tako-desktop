/** Explicit chat-scoped access to the user's live Electron tab over private Host IPC. */
import type { WebContents } from 'electron'
import type { EventEmitter } from 'node:events'
import type { DesktopBrowserAction, DesktopBrowserLeaseId, DesktopBrowserResult } from '@deepseek-ai/dsh-client-ui-sidebar-browser/types'

interface SharedTab {
  readonly lease: DesktopBrowserLeaseId
  readonly sessionId: string
  readonly guest: BrowserGuest
  readonly lifetime: AbortController
  active: boolean
}

/** The small native guest face required by sharing; keeping this structural makes lifecycle tests carrier-free. */
export interface BrowserGuest extends EventEmitter {
  readonly debugger: Pick<WebContents['debugger'], 'attach' | 'detach' | 'isAttached' | 'sendCommand' | 'once' | 'removeListener'>
  isDestroyed(): boolean
  getURL(): string
  loadURL(url: string): Promise<void>
  sendInputEvent(event: Parameters<WebContents['sendInputEvent']>[0]): void
  capturePage(): Promise<{
    getSize(): { width: number }
    resize(options: { width: number }): { toPNG(): Buffer }
    toPNG(): Buffer
  }>
}

const SNAPSHOT = `({url: location.href, title: document.title, text: document.body.innerText.slice(0, 16000),
  elements: Array.from(document.querySelectorAll('a,button,input,textarea,select,[role="button"]')).slice(0,80).map(el => {
    const selector = node => {
      if (node.id) return '#' + CSS.escape(node.id);
      if (!node.parentElement) return node.tagName.toLowerCase();
      const siblings = Array.from(node.parentElement.children).filter(other => other.tagName === node.tagName);
      return selector(node.parentElement) + ' > ' + node.tagName.toLowerCase() + ':nth-of-type(' + (siblings.indexOf(node)+1) + ')';
    };
    return {selector: selector(el), role: el.getAttribute('role') || el.tagName.toLowerCase(),
      label: el.getAttribute('aria-label') || el.innerText || el.getAttribute('placeholder') || el.getAttribute('name'),
      type: el.getAttribute('type'), href: el.getAttribute('href')};
  })})`

/** Owns revocable access; it never copies cookies or launches a second browser. */
export class DesktopBrowserSharing {
  private readonly tabs = new Map<string, SharedTab>()

  /** @param changed - publishes committed state to the owning renderer. @param allowed - host-owned navigation policy. */
  constructor(private readonly changed: (lease: DesktopBrowserLeaseId, shared: boolean) => void,
    private readonly allowed: (url: string) => boolean) {}

  /** @param lease - selected tab. @param sessionId - owning chat. @param guest - approved guest. */
  share(lease: DesktopBrowserLeaseId, sessionId: string, guest: BrowserGuest): void {
    const previous = this.tabs.get(sessionId)
    if (previous?.lease === lease) return
    if (guest.isDestroyed() || !this.allowed(guest.getURL())) throw new Error('Open a web page before sharing this tab.')
    guest.debugger.attach('1.3')
    if (previous !== undefined) this.revoke(previous.lease)
    const tab: SharedTab = { lease, sessionId, guest, lifetime: new AbortController(), active: false }
    const detached = (): void => { this.revoke(lease) }
    guest.debugger.once('detach', detached)
    guest.once('destroyed', detached)
    tab.lifetime.signal.addEventListener('abort', () => {
      guest.debugger.removeListener('detach', detached)
      guest.removeListener('destroyed', detached)
      if (!guest.isDestroyed() && guest.debugger.isAttached()) guest.debugger.detach()
    }, { once: true })
    this.tabs.set(sessionId, tab)
    this.changed(lease, true)
  }

  /** Revoke before returning; already dispatched page effects cannot be undone. @param lease - tab being closed or unshared. */
  revoke(lease: DesktopBrowserLeaseId): void {
    for (const [sessionId, tab] of this.tabs) {
      if (tab.lease !== lease) continue
      this.tabs.delete(sessionId)
      tab.lifetime.abort(new Error('Browser sharing ended. Ask the user to share a tab again.'))
      this.changed(lease, false)
    }
  }

  /** End all grants when the Host stops; browser storage remains intact. */
  revokeAll(): void { for (const tab of this.tabs.values()) this.revoke(tab.lease) }

  /**
   * Execute against only this chat's current grant. Concurrent mutations are refused.
   * @param sessionId - derived by the Host from the executing Agent, never a tool argument.
   * @param request - validated page action.
   * @param signal - tool cancellation or Host shutdown.
   * @returns bounded page text and optional PNG screenshot.
   */
  async run(sessionId: string, request: DesktopBrowserAction, signal: AbortSignal): Promise<DesktopBrowserResult> {
    signal.throwIfAborted()
    const tab = this.tabs.get(sessionId)
    if (request.action === 'status') return { shared: tab !== undefined,
      text: tab === undefined ? 'No tab is shared with this chat.' : `Shared tab: ${tab.guest.getURL()}` }
    if (tab === undefined) throw new Error('No tab is shared. Ask the user to choose “Share with Agent” in this chat’s Browser tab.')
    if (tab.active) throw new Error('A shared browser action is still running. Wait for its result before the next action.')
    const combined = AbortSignal.any([signal, tab.lifetime.signal, AbortSignal.timeout(15_000)])
    const check = (): void => { combined.throwIfAborted() }
    const command = async (method: string, params: object = {}): Promise<unknown> => {
      check()
      const result: unknown = await tab.guest.debugger.sendCommand(method, params)
      check()
      return result
    }
    tab.active = true
    let abort: (() => void) | undefined
    try {
      const interrupted = new Promise<never>((_resolve, reject) => {
        abort = () => {
          if (!tab.guest.isDestroyed() && tab.guest.debugger.isAttached()) {
            void tab.guest.debugger.sendCommand('Runtime.terminateExecution').catch((error: unknown) => {
              // Detachment also terminates the command transport; report only while it is still owned.
              if (!combined.aborted) console.error('Desktop browser cancellation failed', error)
            })
          }
          reject(new Error('Browser action interrupted; inspect the page before retrying. Some effects may already have occurred.'))
        }
        combined.addEventListener('abort', abort, { once: true })
      })
      const result = await Promise.race([this.execute(tab.guest, request, command, check), interrupted])
      check()
      return result
    } finally {
      if (abort !== undefined) combined.removeEventListener('abort', abort)
      tab.active = false
    }
  }

  private async execute(guest: BrowserGuest, request: DesktopBrowserAction,
    command: (method: string, params?: object) => Promise<unknown>, check: () => void): Promise<DesktopBrowserResult> {
    const value = (): string => {
      if (request.value === undefined || request.value.length > 32_000) throw new Error('This action requires value (at most 32000 characters).')
      return request.value
    }
    const coordinates = (): { x: number; y: number } => {
      const { x, y } = request
      if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) {
        throw new Error('This action requires finite x and y coordinates.')
      }
      return { x, y }
    }
    switch (request.action) {
      case 'snapshot':
      case 'evaluate': {
        const expression = request.action === 'snapshot' ? SNAPSHOT : value()
        const result = await command('Runtime.evaluate', {
          expression: `(async () => {const value = await (${expression}); const text = JSON.stringify(value) ?? String(value); return text.length > 32000 ? text.slice(0,31950) + '\\n[truncated; request a narrower result]' : text;})()`,
          returnByValue: true, awaitPromise: true, userGesture: true, timeout: 10_000,
        })
        if (typeof result !== 'object' || result === null || !('result' in result)) throw new Error('The page returned no result.')
        if ('exceptionDetails' in result) throw new Error('The page expression failed. Inspect the page and correct the expression before retrying.')
        const remote = result.result
        if (typeof remote !== 'object' || remote === null || !('value' in remote) || typeof remote.value !== 'string') {
          throw new Error('The page did not return serializable text.')
        }
        return { shared: true, text: remote.value }
      }
      case 'navigate': {
        const url = value()
        if (!this.allowed(url)) throw new Error('Use an HTTP(S) page outside the DSH application.')
        check()
        await guest.loadURL(url)
        break
      }
      case 'click': {
        const point = coordinates()
        await command('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 })
        await command('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 })
        break
      }
      case 'type': await command('Input.insertText', { text: value() }); break
      case 'press': {
        const key = value()
        check()
        guest.sendInputEvent({ type: 'keyDown', keyCode: key })
        check()
        guest.sendInputEvent({ type: 'keyUp', keyCode: key })
        break
      }
      case 'scroll':
        await command('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 0, y: 0, deltaX: coordinates().x, deltaY: coordinates().y }); break
      case 'screenshot': {
        check()
        const screenshot = await guest.capturePage()
        check()
        const image = (screenshot.getSize().width > 1440 ? screenshot.resize({ width: 1440 }) : screenshot).toPNG()
        if (image.length > 6 * 1024 * 1024) throw new Error('Screenshot is too large; use a page snapshot instead.')
        return { shared: true, text: guest.getURL(), image: image.toString('base64') }
      }
      case 'status': return { shared: true, text: guest.getURL() }
    }
    check()
    return { shared: true, text: `Action completed on ${guest.getURL()}. Take a snapshot to inspect the result.` }
  }
}
