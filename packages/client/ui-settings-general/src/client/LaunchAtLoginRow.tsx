/** Desktop launch-at-login toggle; OS registration and confirmation stay in Electron. */
import { useState } from 'react'
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { DesktopLaunchAtLoginSource } from './desktop-launch-at-login-source.ts'
import css from './LaunchAtLoginRow.module.css'

/** Shell observation and the explicit toggle action. */
export interface LaunchAtLoginRowInjected {
  hooks: { launchAtLogin: DesktopLaunchAtLoginSource['store'] }
  select(open: boolean): Promise<void>
}

/**
 * Render the Desktop-only login-item toggle without depending on a Host settings service.
 * @param props - Shell observation, toggle action and localized copy.
 * @returns The General settings row, hidden where the OS has no login items.
 */
export function LaunchAtLoginRow({ useLaunchAtLogin, select, t }:
  PropsRuntime<'settings.general.item'> & PropsLocale<'settings'> & InjectFace<LaunchAtLoginRowInjected>) {
  const { state, failed, pending } = useLaunchAtLogin(value => value)
  const [busy, setBusy] = useState(false)
  if (state?.supported === false) return null
  return <div className={css.row}>
    <div>
      <div className={css.title}>{t('desktop.launchAtLogin.title')}</div>
      <div className={css.description}>{t('desktop.launchAtLogin.description')}</div>
      {failed && <div role="alert">{t('desktop.launchAtLogin.error')}</div>}
    </div>
    <Switch checked={pending ?? state?.enabled ?? false} disabled={busy || state === undefined}
      label={t('desktop.launchAtLogin.title')}
      onChange={(next) => {
        setBusy(true)
        void select(next).finally(() => { setBusy(false) })
      }} />
  </div>
}
