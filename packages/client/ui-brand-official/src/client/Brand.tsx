import { BrandWordmark, FishLogo } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'

/**
 * Render the official mark with the presentation requested by its host surface.
 * @param props - Host-supplied mark presentation.
 * @returns the official whale mark.
 */
export function OfficialBrandMark({ size }: SidebarBrandMarkOwnerProps) {
  return <FishLogo size={size} />
}

/**
 * Render the official name artwork without its independently slotted mark.
 * @returns the official name wordmark.
 */
export function OfficialBrandName() {
  return <BrandWordmark includeMark={false} />
}

/**
 * Render the DSH Tako octopus mark (Tako Switch mascot artwork) for the Tako-backed Desktop.
 * @param props - Host-supplied mark presentation.
 * @returns the Tako mark.
 */
export function TakoBrandMark({ size }: SidebarBrandMarkOwnerProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 1024 1024" fill="none" aria-hidden="true" data-testid="tako-brand-mark">
      <rect width="1024" height="1024" rx="220" fill="#F06858" />
      <g fill="#FFBCB5">
        <rect x="295" y="570" width="56" height="180" rx="28" />
        <rect x="381" y="570" width="56" height="210" rx="28" />
        <rect x="484" y="570" width="56" height="230" rx="28" />
        <rect x="587" y="570" width="56" height="210" rx="28" />
        <rect x="673" y="570" width="56" height="180" rx="28" />
        <ellipse cx="512" cy="400" rx="260" ry="240" />
      </g>
      <ellipse cx="420" cy="410" rx="50" ry="54" fill="white" />
      <ellipse cx="430" cy="420" rx="28" ry="30" fill="#2D3436" />
      <ellipse cx="604" cy="410" rx="50" ry="54" fill="white" />
      <ellipse cx="614" cy="420" rx="28" ry="30" fill="#2D3436" />
      <path d="M 470 480 Q 512 516 554 480" stroke="#E07060" strokeWidth="10" fill="none" strokeLinecap="round" />
    </svg>
  )
}

/**
 * Render the DSH Tako product name beside its mark.
 * @returns the product name.
 */
export function TakoBrandName() {
  return <span data-testid="tako-brand-name" style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-0.01em' }}>DSH Tako</span>
}

/** Hero headline props: the standard locale seat of the DSH Tako brand namespace. */
export type TakoHeroTitleProps = PropsLocale<'brand.tako'>

/**
 * Render the DSH Tako blank-session headline in place of the official headline and preview badge.
 * @param props - composed slot props.
 * @returns the headline text.
 */
export function TakoHeroTitle({ t }: TakoHeroTitleProps) {
  return <span data-testid="tako-hero-title">{t('heroHeadline')}</span>
}
