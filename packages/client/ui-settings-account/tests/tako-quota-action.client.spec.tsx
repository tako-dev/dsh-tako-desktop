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

/** Leaf text of the card's copy column, in document order. */
function leaves(node: Element): string[] {
  const kids = [...node.children]
  return kids.length === 0 ? [node.textContent ?? ''] : kids.flatMap(leaves)
}

function lines(view: ReturnType<typeof render>): string[] {
  const copy = view.container.querySelector('button > span:last-child')
  return copy === null ? [] : leaves(copy)
}

describe('TakoQuotaAction', () => {
  it('shows the official-page hint exactly once when signed out or the quota read failed', () => {
    for (const quota of [null, { status: 'failed', code: 'MISSING_CREDENTIAL' }] as Quota[]) {
      const view = mount(quota)
      expect(lines(view)).toEqual(['Tako', '套餐、充值和续费在 Tako 官方页面完成'])
      expect(view.getAllByText('套餐、充值和续费在 Tako 官方页面完成')).toHaveLength(1)
      view.unmount()
    }
  })

  it('shows the hint once in English while the quota is still loading', () => {
    const view = mount(undefined, en)
    expect(lines(view)).toEqual(['Tako', 'Loading…'])
  })

  it('shows the 5h window and weekly quota when a plan is active, not the wallet balance', () => {
    const view = mount({
      status: 'ready',
      value: {
        account: { balance: 12, plans: [{ title: 'Pro' }] },
        plan: { windowCostLimit: 200, windowMinutes: 300, weeklyCostLimit: 50 },
        usage: { windowCost: 0.05, weeklyCost: 7 },
      },
    })
    expect(lines(view)).toEqual(['Tako', '套餐', '5h', '0.05 / 200', '本周', '7 / 50'])
    expect(view.container.querySelector('[data-tako-quota="plan"]')).not.toBeNull()
    expect(view.container.textContent).not.toContain('余额')
  })

  it('shows the wallet balance when there is no plan', () => {
    const view = mount({
      status: 'ready',
      value: { account: { balance: 12, currency: 'USD' }, usage: { dailyCost: 3, weeklyCost: 7 } },
    })
    expect(lines(view)).toEqual(['Tako', '余额', '$12.00'])
    expect(view.container.querySelector('[data-tako-quota="balance"]')).not.toBeNull()
  })

  it('treats a weekly or window limit as a plan even without a plan title', () => {
    const view = mount({
      status: 'ready',
      value: {
        plan: { weeklyCostLimit: 930, windowCostLimit: 200, windowMinutes: 300 },
        usage: { weeklyCost: 420, windowCost: 1 },
      },
    })
    expect(lines(view)).toEqual(['Tako', '套餐', '5h', '1 / 200', '本周', '420 / 930'])
  })
})
