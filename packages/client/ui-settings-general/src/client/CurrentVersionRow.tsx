/** Installed release version in General Settings for Web and Desktop. */
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './CurrentVersionRow.module.css'

/** Optional Desktop product version and check-for-updates action; absent in the browser. */
export interface CurrentVersionRowInjected {
  openDesktopUpdate?: () => void
  /** Packaged DSH Tako application version; absent in the browser. */
  productVersion?: string
}

/**
 * Render Desktop product + kernel versions, or the Web client build version.
 * Partial builds without any version metadata omit the row.
 * @param props - runtime share, localized copy, optional Desktop product version and updater.
 * @returns the version label(s), or nothing when build metadata is absent.
 */
export function CurrentVersionRow({ t, openDesktopUpdate, productVersion }:
  PropsRuntime<'settings.general.item'> & PropsLocale<'settings'> & InjectFace<CurrentVersionRowInjected>) {
  const version = process.env.DSH_CLIENT_VERSION
  const check = openDesktopUpdate === undefined ? null : (
    <button type="button" className={css.check} onClick={() => { openDesktopUpdate() }}>
      {t('general.checkUpdates')}
    </button>
  )
  if (productVersion !== undefined && productVersion !== '') {
    return <div className={css.stack}>
      <div className={css.row}>
        <span>{t('general.productVersion', { version: productVersion })}</span>
        {check}
      </div>
      {version === undefined ? null : (
        <div className={css.kernel}>{t('general.kernelVersion', { version })}</div>
      )}
    </div>
  }
  if (version === undefined) return null
  return <div className={css.row}>
    <span>{t('general.currentVersion', { version })}</span>
    {check}
  </div>
}
