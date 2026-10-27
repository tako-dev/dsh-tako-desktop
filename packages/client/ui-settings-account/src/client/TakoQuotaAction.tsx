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

function pairText(value: string | undefined, limit: string | undefined, noData: string): string {
  if (value === undefined) return noData
  return limit === undefined || limit === '0' ? value : `${value} / ${limit}`
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
  const noData = t('takoQuotaNoData')
  const windowPair = pairText(
    valueText(snapshot?.value?.usage?.windowCost),
    valueText(snapshot?.value?.plan?.windowCostLimit),
    noData,
  )
  const weeklyPair = pairText(
    valueText(snapshot?.value?.usage?.weeklyCost),
    valueText(snapshot?.value?.plan?.weeklyCostLimit),
    noData,
  )
  const windowLabel = windowHoursLabel(snapshot?.value?.plan?.windowMinutes)
  const summary = quota === undefined
    ? t('loading')
    : ready
      ? onPlan ? `${windowLabel} ${windowPair}` : (balance ?? noData)
      : t('takoQuotaUnavailable')
  const label = `${t('takoQuota')} · ${summary}`
  const openAccount = (): void => { window.open('https://tako.shiroha.tech/wallet', '_blank', 'noopener,noreferrer') }
  const body = !wide ? null : onPlan ? (
    <span className={css.metrics}>
      <span className={css.metric}>
        <span className={css.metricLabel}>{windowLabel}</span>
        <span className={css.metricValue}>{windowPair}</span>
      </span>
      <span className={css.metric}>
        <span className={css.metricLabel}>{t('takoWeeklyShort')}</span>
        <span className={css.metricValueSecondary}>{weeklyPair}</span>
      </span>
    </span>
  ) : ready ? (
    <span className={css.balanceBlock}>
      <span className={css.metricLabel}>{t('takoBalance')}</span>
      <span className={css.balanceValue}>{balance ?? noData}</span>
    </span>
  ) : (
    <span className={css.detail}>{quota === undefined ? t('loading') : t('takoAccountHint')}</span>
  )
  const content = (
    <button type="button" className={wide ? css.action : css.railAction} data-tako-quota={onPlan ? 'plan' : ready ? 'balance' : 'empty'} aria-label={label} onClick={openAccount}>
      <span className={css.icon} aria-hidden="true">
        {wide ? <TakoLogo size={24} /> : <IconGaugeOutlineRegular size={18} />}
      </span>
      {wide ? (
        <span className={css.copy}>
          <span className={css.title}>
            <span>{t('takoBrand')}</span>
            {onPlan ? <span className={css.planChip}>{t('takoPlan')}</span> : null}
          </span>
          {body}
        </span>
      ) : null}
    </button>
  )
  return wide ? content : <Tooltip label={label} side="right">{content}</Tooltip>
}
