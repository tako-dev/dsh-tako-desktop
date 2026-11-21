/** OS login-item registration behind an injectable seam; tests never touch real login items. */
import type { App, LoginItemSettings, MessageBoxOptions, MessageBoxReturnValue, Settings } from 'electron'
import type { DesktopMessages } from './locale.ts'

/** Result fields read by the launch-at-login policy; Electron returns more. */
export type DesktopLoginItemRead = Pick<LoginItemSettings, 'openAtLogin'>

/** Platform-shaped write; Windows pins the executable path and approval state. */
export type DesktopLoginItemWrite = Pick<Settings, 'openAtLogin' | 'path' | 'enabled'>

/**
 * Minimal Electron `app` surface for login items.
 * `electron.app` satisfies this interface; tests substitute a stub so no host
 * login item or Run key is ever created.
 */
export interface DesktopLoginItems {
  getLoginItemSettings(): DesktopLoginItemRead
  setLoginItemSettings(settings: DesktopLoginItemWrite): void
}

/**
 * Adapt `electron.app`; a single seam keeps the real OS calls out of tests.
 * @param app - Running Electron application.
 * @returns The login-item registration seam.
 */
export function electronLoginItems(app: App): DesktopLoginItems {
  return app
}

/**
 * Login items exist only on macOS and Windows; other platforms hide the setting.
 * @param platform - Operating system, usually `process.platform`.
 * @returns Whether the OS registration calls apply.
 */
export function supportsDesktopLaunchAtLogin(platform: NodeJS.Platform): boolean {
  return platform === 'darwin' || platform === 'win32'
}

/** Outcome of one explicit user request to change the OS registration. */
export type DesktopLaunchAtLoginResult =
  | { readonly kind: 'applied' | 'unchanged' | 'cancelled' | 'unsupported'; readonly enabled: boolean }

/** Main-process collaborators of the launch-at-login policy. */
export interface DesktopLaunchAtLoginOptions {
  readonly loginItems: DesktopLoginItems
  readonly executable: string
  readonly platform: NodeJS.Platform
  readonly messages: () => DesktopMessages
  /** Native confirmation before the first OS registration; resolves like a cancelled box without a window. */
  readonly confirm: (options: MessageBoxOptions) => Promise<MessageBoxReturnValue>
}

/**
 * Launch-at-login stays off until a user enables it through Settings; the OS
 * registration is the persisted preference, and nothing is written at startup.
 * Enabling asks for a native confirmation first; disabling applies directly.
 */
export class DesktopLaunchAtLogin {
  constructor(private readonly options: DesktopLaunchAtLoginOptions) {}

  /** @returns Whether this platform offers the setting. */
  supported(): boolean {
    return supportsDesktopLaunchAtLogin(this.options.platform)
  }

  /** @returns Current OS registration; false on unsupported platforms. */
  enabled(): boolean {
    return this.supported() && this.options.loginItems.getLoginItemSettings().openAtLogin
  }

  /**
   * Apply an explicit user choice; enabling prompts before registering.
   * @param open - Requested login-item state.
   * @returns The registration outcome; the stored state only moves on `applied`.
   */
  async set(open: boolean): Promise<DesktopLaunchAtLoginResult> {
    if (!this.supported()) return { kind: 'unsupported', enabled: false }
    if (this.enabled() === open) return { kind: 'unchanged', enabled: open }
    if (open) {
      const messages = this.options.messages()
      const result = await this.options.confirm({
        type: 'info',
        title: messages.launchAtLoginTitle,
        message: messages.launchAtLoginTitle,
        detail: messages.launchAtLoginDetail,
        buttons: [messages.launchAtLoginEnable, messages.cancel],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      })
      if (result.response !== 0) return { kind: 'cancelled', enabled: this.enabled() }
    }
    this.options.loginItems.setLoginItemSettings(this.options.platform === 'win32'
      ? { openAtLogin: open, path: this.options.executable, enabled: open }
      : { openAtLogin: open })
    return { kind: 'applied', enabled: this.enabled() }
  }
}
