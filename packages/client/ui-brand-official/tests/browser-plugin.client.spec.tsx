// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { apply, inject } from '../src/client/index.ts'
import { OfficialBrandMark, OfficialBrandName, TakoBrandMark, TakoHeroTitle, type TakoHeroTitleProps } from '../src/client/Brand.tsx'
import { en, zh } from '../src/client/locales.ts'
import { apply as hostApply } from '../src/index.ts'

const TAKO_PROFILE_GLOBAL = '__DSH_TAKO_PROFILE__'

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  Reflect.deleteProperty(globalThis, TAKO_PROFILE_GLOBAL)
})

const HOLES = [
  'sidebar.brand.mark',
  'sidebar.brand.name',
] as const

const HERO_HOLE = 'conversation.hero.brand.mark'
const HERO_TITLE_HOLE = 'conversation.hero.brand.title'
const ALL_HOLES = [...HOLES, HERO_HOLE, HERO_TITLE_HOLE] as const

/** Minimal locale face: records each namespace registration and its disposal. */
function localeStub() {
  const registered = new Map<string, unknown>()
  const service = {
    register: vi.fn((ns: string, dicts: unknown) => {
      registered.set(ns, dicts)
      return () => { registered.delete(ns) }
    }),
  }
  return { registered, service }
}

async function bench(declare = true) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = localeStub()
  ctx.provide('locale', locale.service)
  const slots = ctx.get('slots') as SlotRegistry
  const declareHoles = () => slots.register({
    name: 'root',
    children: Object.fromEntries([...HOLES, HERO_HOLE, HERO_TITLE_HOLE].map(name => [name, { kind: 'single', scope: 'root' }])),
  } as never, () => null)
  const disposeHoles = declare ? declareHoles() : undefined
  return { ctx, slots, locale, declareHoles, disposeHoles }
}

describe('official browser-brand plugin', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('declares only the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale'])
  })

  it('leaves every slot empty outside the official build profile', async () => {
    vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'local')
    const subject = await bench()
    await subject.ctx.plugin({ inject: [...inject], apply }).await()
    for (const hole of HOLES) expect(subject.slots.entries(hole)).toHaveLength(0)
  })

  it('fills declarations before or after apply and removes every occupant on teardown', async () => {
    vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'official')
    const before = await bench()
    const fiber = before.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    for (const hole of HOLES) expect(before.slots.entries(hole)).toHaveLength(1)

    before.disposeHoles?.()
    for (const hole of HOLES) expect(before.slots.entries(hole)).toHaveLength(0)
    before.declareHoles()
    await Promise.resolve()
    for (const hole of HOLES) expect(before.slots.entries(hole)).toHaveLength(1)

    await fiber.dispose()
    for (const hole of HOLES) expect(before.slots.entries(hole)).toHaveLength(0)

    const after = await bench(false)
    await after.ctx.plugin({ inject: [...inject], apply }).await()
    for (const hole of HOLES) expect(after.slots.entries(hole)).toHaveLength(0)
    after.declareHoles()
    await Promise.resolve()
    for (const hole of HOLES) expect(after.slots.entries(hole)).toHaveLength(1)
  })

  it('leaves the conversation hero on its declaring fallback even in official builds', async () => {
    vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'official')
    const subject = await bench()
    await subject.ctx.plugin({ inject: [...inject], apply }).await()
    expect(subject.slots.entries(HERO_HOLE)).toHaveLength(0)
    expect(subject.slots.entries(HERO_TITLE_HOLE)).toHaveLength(0)
    expect(subject.locale.registered.size).toBe(0)
  })

  it('replaces the sidebar brand and the conversation hero under the DSH Tako profile in any build profile', async () => {
    vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'local')
    ;(globalThis as Record<string, unknown>)[TAKO_PROFILE_GLOBAL] = true
    const subject = await bench()
    const fiber = subject.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    for (const hole of ALL_HOLES) expect(subject.slots.entries(hole)).toHaveLength(1)
    expect(subject.locale.registered.get('brand.tako')).toEqual({ en, zh })

    await fiber.dispose()
    for (const hole of ALL_HOLES) expect(subject.slots.entries(hole)).toHaveLength(0)
    expect(subject.locale.registered.size).toBe(0)
  })

  it('renders the DSH Tako hero mark and headline copy in both shipped languages', () => {
    const mark = render(<TakoBrandMark size={34} />)
    expect(mark.getByTestId('tako-brand-mark').getAttribute('width')).toBe('34')
    mark.unmount()
    expect(en.heroHeadline).toBe('Let Tako get it done')
    expect(zh.heroHeadline).toBe('让 Tako 帮你完成任务')
    const t: TakoHeroTitleProps['t'] = key => (key === 'heroHeadline' ? zh.heroHeadline : key)
    const title = render(<TakoHeroTitle t={t} />)
    expect(title.getByTestId('tako-hero-title').textContent).toBe('让 Tako 帮你完成任务')
    expect(title.queryByText('预览版')).toBeNull()
  })

  it('renders the official name independently from both requested mark sizes', () => {
    const name = render(<OfficialBrandName />)
    expect(name.container.querySelector('svg')?.getAttribute('viewBox')).toBe('26 0 156 24')
    name.unmount()

    const mark = render(<OfficialBrandMark size={34} />)
    expect(mark.container.querySelector('svg')?.getAttribute('width')).toBe('34')
    mark.rerender(<OfficialBrandMark size={24} />)
    expect(mark.container.querySelector('svg')?.getAttribute('width')).toBe('24')
  })
})
