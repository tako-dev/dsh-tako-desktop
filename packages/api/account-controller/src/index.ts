/** Authenticated Remote operations for account UI consumers. */
import { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { TakoQuotaView } from './types.ts'

export type * from './types.ts'

/**
 * Tako quota commands sharing the `account` wire namespace.
 *
 * Upstream rc.3 moved every other account operation onto the `deepseekAccount`
 * service; this controller remains only for the Tako-only `getTakoQuota`
 * method, which upstream does not carry.
 */
export class AccountController extends TypertRemoteService {
  /** @param ctx - Host with the Tako client service optionally mounted. */
  constructor(ctx: Context) { super(ctx, 'accountController', { namespace: 'account' }) }
  /**
   * Read the current Tako API-key quota for the settings page.
   *
   * The method deliberately returns a redacted status projection. API keys
   * and provider response bodies never cross the Remote boundary. Official
   * DSH profiles without the Tako bundle report `null`.
   * @returns A redacted quota result, or null when the Tako service is absent.
   */
  @Remote
  async getTakoQuota(): Promise<TakoQuotaView | null> {
    const client = this.ctx.get('takoClient') as { quota: () => Promise<NonNullable<TakoQuotaView['value']>> } | undefined
    if (client === undefined) return null
    try {
      const value = await client.quota()
      return {
        status: 'ready',
        value: {
          ...value.apiId === undefined ? {} : { apiId: value.apiId },
          source: value.source,
          fetchedAt: value.fetchedAt,
          ...value.account === undefined ? {} : { account: value.account },
          ...value.plan === undefined ? {} : { plan: value.plan },
          ...value.usage === undefined ? {} : { usage: value.usage },
        },
      }
    } catch (error: unknown) {
      const code = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : 'UNAVAILABLE'
      const allowed = ['MISSING_CREDENTIAL', 'AUTH', 'TRANSPORT', 'BILLING', 'RATE_LIMIT', 'SERVER'] as const
      const safeCode: NonNullable<TakoQuotaView['code']> = (allowed as readonly string[]).includes(code)
        ? code as NonNullable<TakoQuotaView['code']>
        : 'UNAVAILABLE'
      return { status: 'failed', code: safeCode }
    }
  }
}
export default AccountController
