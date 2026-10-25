/** Official DeepSeek Harness occupants for the generic browser-brand slots. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { OfficialBrandMark, OfficialBrandName, TakoBrandMark, TakoBrandName, TakoHeroTitle } from './Brand.tsx'
import { en, zh, type TakoBrandKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** DSH Tako hero copy. */
    'brand.tako': TakoBrandKey
  }
}

/** Page global the Tako bundle injects when the active profile is Tako-backed (DSH Tako Desktop). */
const TAKO_PROFILE_GLOBAL = '__DSH_TAKO_PROFILE__'

/** Dictionary namespace for the DSH Tako hero copy. */
const TAKO_NS = 'brand.tako'

/** Required services: the UI slot registry and the dictionary the DSH Tako hero reads. */
export const inject = ['slots', 'locale']

/**
 * Fill the sidebar brand slots as one declaration-aware registration set. The
 * conversation hero stays on its declaring package's animated fish fallback
 * in the official build; the DSH Tako profile also replaces the hero mark and
 * headline with its own.
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
  if (!tako) return
  ctx.effect(() => ctx.locale.register(TAKO_NS, { en, zh }), 'brand: DSH Tako dictionaries')
  ctx.slots.inject('conversation.hero.brand.mark', () =>
    ctx.slots.inject('conversation.hero.brand.title', function* () {
      yield ctx.slots.register({ name: 'conversation.hero.brand.mark' }, TakoBrandMark)
      yield ctx.slots.register({ name: 'conversation.hero.brand.title', locale: TAKO_NS }, TakoHeroTitle)
    }))
}
