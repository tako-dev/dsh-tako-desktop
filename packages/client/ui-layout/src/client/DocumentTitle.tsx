/** Browser title selection follows the active main panel without subscribing the frame. */
import { useEffect } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

/**
 * Page global a Host-side bundle may set through `webserver/index-inject` to retitle the product for one
 * profile (DSH Tako sets "DSH Tako"); absent, the build-configured title stays in effect.
 */
export const CLIENT_TITLE_GLOBAL = '__DSH_CLIENT_TITLE__'

/**
 * Choose the product title: a non-blank page-injected title, else the build title, else the fallback.
 * @param buildTitle - Build-configured title (`DSH_CLIENT_TITLE`), when set.
 * @param fallback - Localized local-build title.
 * @param page - Global object carrying the optional injected title.
 * @returns the product title.
 */
export function resolveProductTitle(buildTitle: string | undefined, fallback: string, page: object = globalThis): string {
  const injected = (page as Partial<Record<typeof CLIENT_TITLE_GLOBAL, unknown>>)[CLIENT_TITLE_GLOBAL]
  if (typeof injected === 'string' && injected.trim() !== '') return injected.trim()
  return buildTitle ?? fallback
}

/** Props for the browser title projection. */
export type DocumentTitleProps = Pick<PropsRuntime<'root'>, 'useSessions' | 'usePanelInfo'> & {
  /** Build-configured or localized product title. */
  productTitle: string
}

/**
 * Project the selected durable session title into the browser title and
 * restore the build-selected product title when unmounted.
 * @param props - Selected session title projection.
 * @returns No rendered content.
 */
export function DocumentTitle({ useSessions, usePanelInfo, productTitle }: DocumentTitleProps): null {
  const showSessionTitle = usePanelInfo(info => info.activePanelId === null)
  const title = useSessions((state) => {
    const current = Object.values(state.byId)
      .find(session => (session.retainedBy.mainView ?? 0) > 0)?.id
    return !showSessionTitle || current === undefined ? undefined : state.byId[current]?.title
  })
  useEffect(() => {
    document.title = title === undefined ? productTitle : `${title} — ${productTitle}`
    return () => { document.title = productTitle }
  }, [productTitle, title])
  return null
}
