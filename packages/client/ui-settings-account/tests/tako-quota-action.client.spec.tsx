// @vitest-environment jsdom
/** Sidebar-footer Tako quota card: every line renders once, in each quota state. */
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { AccountSnapshot } from '../src/client/AccountSection.tsx'
import type {} from '../src/client/index.ts'
import { TakoQuotaAction } from '../src/client/TakoQuotaAction.tsx'
import { en, zh, type AccountKey } from '../src/client/locales.ts'

afterEach(() => { cleanup() })

type Quota = AccountSnapshot['takoQuota']

function mount(takoQuota: Quota, dictionary: Record<AccountKey, string> = zh) {
  const account: AccountSnapshot = {
    view: undefined, details: undefined, avatar: undefined, failed: false, takoMode: true,
    ...(takoQuota === undefined ? {} : { takoQuota }),
  }
  const props = {
    wide: true,
    t: (key: AccountKey) => dictionary[key],
    useAccount: <T,>(select: (value: AccountSnapshot) => T) => select(account),
  }
  return render(<TakoQuotaAction {...(props as unknown as Parameters<typeof TakoQuotaAction>[0])} />)
}

/** Text of each rendered line inside the card's copy column, in order. */
function lines(view: ReturnType<typeof render>): string[] {
  const copy = view.container.querySelector('button > span:last-child')
  return [...copy?.children ?? []].flatMap(child =>
    child.children.length > 0 ? [...child.children].map(part => part.textContent ?? '') : [child.textContent ?? ''])
}

describe('TakoQuotaAction', () => {
  it('shows the official-page hint exactly once when signed out or the quota read failed', () => {
    for (const quota of [null, { status: 'failed', code: 'MISSING_CREDENTIAL' }] as Quota[]) {
      const view = mount(quota)
      expect(lines(view)).toEqual(['Tako', '额度暂不可用', '套餐、充值和续费在 Tako 官方页面完成'])
      expect(view.getAllByText('套餐、充值和续费在 Tako 官方页面完成')).toHaveLength(1)
      expect(view.getAllByText('额度暂不可用')).toHaveLength(1)
      view.unmount()
    }
  })

  it('shows the hint once in English while the quota is still loading', () => {
    const view = mount(undefined, en)
    expect(lines(view)).toEqual(['Tako', 'Loading…', 'Plan, recharge, and renewal are managed on Tako'])
  })

  it('renders balance, plan, daily and weekly usage once each when the quota is ready', () => {
    const view = mount({
      status: 'ready',
      value: {
        account: { balance: 12, plans: [{ title: 'Pro' }] },
        plan: { dailyCostLimit: 10, weeklyCostLimit: 50 },
        usage: { dailyCost: 3, weeklyCost: 7 },
      },
    })
    expect(lines(view)).toEqual(['Tako', '已连接', '余额 12', '套餐 Pro', '今日用量 3 / 10', '本周用量 7 / 50'])
  })

  it('does not repeat usage lines that already serve as the summary and plan line', () => {
    const view = mount({
      status: 'ready',
      value: { usage: { dailyCost: 3, weeklyCost: 7 } },
    })
    expect(lines(view)).toEqual(['Tako', '已连接', '今日用量 3', '本周用量 7'])
  })
})
