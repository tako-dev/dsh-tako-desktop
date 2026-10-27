/** Compact Tako balance and usage affordance in the Desktop sidebar footer. */
import type { ReactNode } from 'react'
import { IconGaugeOutlineRegular, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AccountSectionInjected, TakoQuotaView } from './AccountSection.tsx'
import { formatBalance } from './formatBalance.ts'
import { TakoLogo } from './TakoLogo.tsx'
import css from './TakoQuotaAction.module.css'

type TakoQuotaActionProps = PropsRuntime<'sidebar.footer.action'>
  & PropsLocale<'settings.account'>
  & InjectFace<AccountSectionInjected>

function valueText(value: number | null | undefined): string | undefined {
  return value === null || value === undefined || !Number.isFinite(value) ? undefined : String(value)
}

function usageText(label: string, value: string | undefined, limit: string | undefined, noData: string): string {
  if (value === undefined) return `${label} ${noData}`
  return `${label} ${value}${limit === undefined || limit === '0' ? '' : ` / ${limit}`}`
}

/** Tako subscription windows are typically 300 minutes; fall back to 5h when the server omits it. */
function windowHoursLabel(minutes: number | null | undefined): string {
  const mins = minutes == null || minutes <= 0 ? 300 : minutes
  const hours = mins / 60
  const shown = Number.isInteger(hours) ? String(hours) : String(Math.round(hours * 10) / 10)
  return `${shown}h`
}

function hasActivePlan(value: TakoQuotaView['value']): boolean {
  if (value === undefined) return false
  const titled = (value.account?.plans ?? []).some(plan => plan.title !== undefined && plan.title !== '')
  if (titled) return true
  const weekly = value.plan?.weeklyCostLimit
  const windowLimit = value.plan?.windowCostLimit
  return (weekly != null && weekly > 0) || (windowLimit != null && windowLimit > 0)
}

/** @param props - sidebar geometry, localized copy, and the shared Tako quota snapshot. */
export function TakoQuotaAction({ wide, t, useAccount }: TakoQuotaActionProps): ReactNode {
  const account = useAccount(snapshot => snapshot)
  if (account.takoMode !== true) return null
  const quota = account.takoQuota
  const snapshot = quota !== null && quota !== undefined && quota.status === 'ready' ? quota : undefined
  const ready = snapshot !== undefined
  const takoAccount = snapshot?.value?.account
  const rawBalance = takoAccount?.balance
  const balance = rawBalance === undefined || rawBalance === null || !Number.isFinite(rawBalance)
    ? undefined
    : formatBalance(String(rawBalance), takoAccount?.currency === 'CNY' ? '¥' : '$')
  const onPlan = hasActivePlan(snapshot?.value)
  const windowText = usageText(
    windowHoursLabel(snapshot?.value?.plan?.windowMinutes),
    valueText(snapshot?.value?.usage?.windowCost),
    valueText(snapshot?.value?.plan?.windowCostLimit),
    t('takoQuotaNoData'),
  )
  const weeklyText = usageText(
    t('takoWeeklyUsage'),
    valueText(snapshot?.value?.usage?.weeklyCost),
    valueText(snapshot?.value?.plan?.weeklyCostLimit),
    t('takoQuotaNoData'),
  )
  const summary = quota === undefined
    ? t('loading')
    : ready
      ? onPlan ? windowText : balance === undefined ? t('takoQuotaNoData') : `${t('takoBalance')} ${balance}`
      : t('takoQuotaUnavailable')
  const status = quota === undefined ? t('loading') : ready ? t('takoConnected') : t('takoQuotaUnavailable')
  const details = quota === undefined
    ? [t('takoAccountHint')]
    : ready
      ? onPlan ? [weeklyText] : []
      : [t('takoAccountHint')]
  const label = `${t('takoQuota')} · ${summary}`
  const openAccount = (): void => { window.open('https://tako.shiroha.tech/wallet', '_blank', 'noopener,noreferrer') }
  const content = (
    <button type="button" className={wide ? css.action : css.railAction} aria-label={label} onClick={openAccount}>
      <span className={css.icon} aria-hidden="true">
        {wide ? <TakoLogo size={24} /> : <IconGaugeOutlineRegular size={18} />}
      </span>
      {wide ? (
        <span className={css.copy}>
          <span className={css.title}><span>{t('takoBrand')}</span><span className={ready ? css.connected : css.muted}>{status}</span></span>
          {ready ? <span className={css.summary}>{summary}</span> : null}
          {details.map(line => <span key={line} className={css.detail}>{line}</span>)}
        </span>
      ) : null}
    </button>
  )
  return wide ? content : <Tooltip label={label} side="right">{content}</Tooltip>
}
