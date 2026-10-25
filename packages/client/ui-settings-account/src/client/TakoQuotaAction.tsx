/** Compact Tako balance and usage affordance in the Desktop sidebar footer. */
import type { ReactNode } from 'react'
import { IconGaugeOutlineRegular, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AccountSectionInjected } from './AccountSection.tsx'
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

/** @param props - sidebar geometry, localized copy, and the shared Tako quota snapshot. */
export function TakoQuotaAction({ wide, t, useAccount }: TakoQuotaActionProps): ReactNode {
  const account = useAccount(snapshot => snapshot)
  if (account.takoMode !== true) return null
  const quota = account.takoQuota
  const ready = quota?.status === 'ready'
  const balance = ready ? valueText(quota.value?.account?.balance) : undefined
  const plan = ready ? quota.value?.account?.plans?.map(item => item.title).find(Boolean) : undefined
  const daily = ready ? valueText(quota.value?.usage?.dailyCost) : undefined
  const dailyLimit = ready ? valueText(quota.value?.plan?.dailyCostLimit) : undefined
  const weekly = ready ? valueText(quota.value?.usage?.weeklyCost) : undefined
  const weeklyLimit = ready ? valueText(quota.value?.plan?.weeklyCostLimit) : undefined
  const dailyText = usageText(t('takoDailyUsage'), daily, dailyLimit, t('takoQuotaNoData'))
  const weeklyText = usageText(t('takoWeeklyUsage'), weekly, weeklyLimit, t('takoQuotaNoData'))
  const summary = quota === undefined
    ? t('loading')
    : ready
      ? balance === undefined ? dailyText : `${t('takoBalance')} ${balance}`
      : t('takoQuotaUnavailable')
  const detail = ready
    ? plan === undefined ? weeklyText : `${t('takoPlan')} ${plan}`
    : t('takoAccountHint')
  const label = `${t('takoQuota')} · ${summary}`
  const openAccount = (): void => { window.open('https://tako.shiroha.tech/wallet', '_blank', 'noopener,noreferrer') }
  const content = (
    <button type="button" className={wide ? css.action : css.railAction} aria-label={label} onClick={openAccount}>
      <span className={css.icon} aria-hidden="true">
        {wide ? <TakoLogo size={24} /> : <IconGaugeOutlineRegular size={18} />}
      </span>
      {wide ? (
        <span className={css.copy}>
          <span className={css.title}><span>{t('takoBrand')}</span><span className={ready ? css.connected : css.muted}>{ready ? t('takoConnected') : t('takoQuotaUnavailable')}</span></span>
          <span className={ready ? css.summary : css.muted}>{summary}</span>
          <span className={css.detail}>{detail}</span>
          <span className={css.detail}>{ready ? dailyText : t('takoAccountHint')}</span>
          <span className={css.detail}>{ready ? weeklyText : t('takoQuotaNoData')}</span>
        </span>
      ) : null}
    </button>
  )
  return wide ? content : <Tooltip label={label} side="right">{content}</Tooltip>
}
