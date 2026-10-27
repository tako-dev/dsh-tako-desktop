/** Installed release version in General Settings for Web and Desktop. */
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './CurrentVersionRow.module.css'

/** Optional Desktop check-for-updates action; absent in the browser. */
export interface CurrentVersionRowInjected {
  openDesktopUpdate?: () => void
}

/**
 * Render the version embedded by the client build; partial builds without metadata omit the row.
 * @param props - runtime share, localized copy, and optional Desktop updater.
 * @returns the current release label, or nothing when build metadata is absent.
 */
export function CurrentVersionRow({ t, openDesktopUpdate }:
  PropsRuntime<'settings.general.item'> & PropsLocale<'settings'> & InjectFace<CurrentVersionRowInjected>) {
  const version = process.env.DSH_CLIENT_VERSION
  if (version === undefined) return null
  return <div className={css.row}>
    <span>{t('general.currentVersion', { version })}</span>
    {openDesktopUpdate === undefined ? null : (
      <button type="button" className={css.check} onClick={() => { openDesktopUpdate() }}>
        {t('general.checkUpdates')}
      </button>
    )}
  </div>
}
