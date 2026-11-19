/** Tako quota Remote projection redacts provider payloads and failures. */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, expect, it, vi } from 'vitest'
import AccountController from '../src/index.ts'

const roots: Context[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose())) })

function fixture() {
  const ctx = new Context()
  roots.push(ctx)
  return { ctx, controller: new AccountController(ctx) }
}

it('returns null when no Tako bundle is mounted', async () => {
  const { controller } = fixture()
  await expect(controller.getTakoQuota()).resolves.toBeNull()
})

it('returns a redacted Tako quota projection when the bundle is mounted', async () => {
  const { ctx, controller } = fixture()
  const quota = {
    apiId: '42', source: 'user-quota' as const, fetchedAt: '2026-10-14T00:00:00.000Z',
    account: { balance: 20, currency: 'USD', plans: [{ title: 'Pro' }] },
    plan: { dailyCostLimit: 10, windowCostLimit: 200, windowMinutes: 300, weeklyCostLimit: 50 },
    usage: { dailyCost: 2, windowCost: 0.05, weeklyCost: 7 },
  }
  ctx.provide('takoClient', { quota: vi.fn(async () => quota) } as never)
  await expect(controller.getTakoQuota()).resolves.toEqual({ status: 'ready', value: quota })
})

it('reports Tako quota failures without returning provider details', async () => {
  const { ctx, controller } = fixture()
  ctx.provide('takoClient', { quota: vi.fn(async () => { throw { code: 'AUTH', message: 'secret-key rejected' } }) } as never)
  await expect(controller.getTakoQuota()).resolves.toEqual({ status: 'failed', code: 'AUTH' })
})

it('maps unlisted Tako quota failure codes to UNAVAILABLE', async () => {
  const { ctx, controller } = fixture()
  ctx.provide('takoClient', { quota: vi.fn(async () => { throw new Error('socket hangup') }) } as never)
  await expect(controller.getTakoQuota()).resolves.toEqual({ status: 'failed', code: 'UNAVAILABLE' })
})
