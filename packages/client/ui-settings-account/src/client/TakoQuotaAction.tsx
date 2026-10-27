/** Compact Tako balance and usage affordance in the Desktop sidebar footer. */
import type { ReactNode } from 'react'
import { IconGaugeOutlineRegular, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AccountSectionInjected } from './AccountSection.tsx'
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
  const plan = takoAccount?.plans?.map(item => item.title).find(Boolean)
  const planLine = plan === undefined ? undefined : `${t('takoPlan')} ${plan}`
  const daily = valueText(snapshot?.value?.usage?.dailyCost)
  const dailyLimit = valueText(snapshot?.value?.plan?.dailyCostLimit)
  const weekly = valueText(snapshot?.value?.usage?.weeklyCost)
  const weeklyLimit = valueText(snapshot?.value?.plan?.weeklyCostLimit)
  const dailyText = usageText(t('takoDailyUsage'), daily, dailyLimit, t('takoQuotaNoData'))
  const weeklyText = usageText(t('takoWeeklyUsage'), weekly, weeklyLimit, t('takoQuotaNoData'))
  const summary = quota === undefined
    ? t('loading')
    : ready
      ? balance === undefined ? dailyText : `${t('takoBalance')} ${balance}`
      : t('takoQuotaUnavailable')
  const detail = ready
    ? planLine ?? weeklyText
    : t('takoAccountHint')
  const status = quota === undefined ? t('loading') : ready ? t('takoConnected') : t('takoQuotaUnavailable')
  // The summary or plan line may already carry the daily or weekly usage; each line renders once.
  // Without quota data the status badge already says so, leaving the account hint as the only detail.
  const details = ready ? [...new Set([detail, dailyText, weeklyText])].filter(line => line !== summary) : [detail]
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
          {details.map(line => (
            <span key={line} className={line === planLine ? css.plan : css.detail}>{line}</span>
          ))}
        </span>
      ) : null}
    </button>
  )
  return wide ? content : <Tooltip label={label} side="right">{content}</Tooltip>
}
