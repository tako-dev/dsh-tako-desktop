/** Account Remote values contain no credential payloads. */
export type { AccountBonusBatch, AccountBonusNotification, AccountBonusOrderId, AccountClientMetadata, AccountDetails, AccountProfile, AccountUserId, AccountView, SignInAttemptId } from '@deepseek-ai/dsh-deepseek-account/types'

/** Redacted read-only Tako quota view for the account settings page. */
export interface TakoQuotaView {
  status: 'ready' | 'failed'
  value?: {
    apiId?: string
    account?: {
      balance?: number | null
      used?: number | null
      currency?: string
      plans?: readonly { id?: number; title?: string; expiresAt?: number }[]
    }
    source: 'user-quota' | 'user-stats'
    fetchedAt: string
    plan?: {
      windowCostLimit?: number | null
      windowMinutes?: number | null
      dailyCostLimit?: number | null
      weeklyCostLimit?: number | null
      monthlyCostLimit?: number | null
    }
    usage?: {
      windowCost?: number | null
      dailyCost?: number | null
      weeklyCost?: number | null
      monthlyCost?: number | null
    }
  }
  code?: 'MISSING_CREDENTIAL' | 'AUTH' | 'TRANSPORT' | 'BILLING' | 'RATE_LIMIT' | 'SERVER' | 'UNAVAILABLE'
}
