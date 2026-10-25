/** Official DeepSeek Harness occupants for the generic browser-brand slots. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { OfficialBrandMark, OfficialBrandName, TakoBrandMark, TakoBrandName } from './Brand.tsx'

/** Page global the Tako bundle injects when the active profile is Tako-backed (DSH Tako Desktop). */
const TAKO_PROFILE_GLOBAL = '__DSH_TAKO_PROFILE__'

/** Required service: the UI slot registry. */
export const inject = ['slots']

/**
 * Fill the sidebar brand slots as one declaration-aware registration set. The
 * conversation hero stays on its declaring package's animated fish fallback,
 * so the official build registers nothing there.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  // DSH Tako shows its own product brand, in any build profile, instead of the official mark.
  const tako = (globalThis as Partial<Record<typeof TAKO_PROFILE_GLOBAL, unknown>>)[TAKO_PROFILE_GLOBAL] === true
  if (!tako && process.env.DSH_CLIENT_BUILD_PROFILE !== 'official') return
  const Mark = tako ? TakoBrandMark : OfficialBrandMark
  const Name = tako ? TakoBrandName : OfficialBrandName
  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.inject('sidebar.brand.name', function* () {
      yield ctx.slots.register({ name: 'sidebar.brand.mark' }, Mark)
      yield ctx.slots.register({ name: 'sidebar.brand.name' }, Name)
    }))
}
