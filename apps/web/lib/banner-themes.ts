import type { HomeBanner } from './queries'

// Per-theme accent color -- used two ways: (1) tints a banner's own title
// badge/CTA, and (2) while a themed banner is active, retints the site's
// primary buttons/accents (--brand-orange) so a festival promo actually reads
// as festive across the storefront, not just inside the banner image itself.
export const THEME_COLORS: Record<HomeBanner['theme'], string | null> = {
  default: null,
  diwali: '#D4A017',
  christmas: '#1E7145',
  sale: '#1D4ED8',
  custom: null, // resolved per-banner from custom_color instead
}

export function resolveThemeColor(banner: Pick<HomeBanner, 'theme' | 'custom_color'>): string | null {
  return banner.theme === 'custom' ? banner.custom_color : THEME_COLORS[banner.theme]
}

// Simple multiplicative darken for a hover/active shade -- avoids needing a
// full color library for one derived value.
export function darkenColor(hex: string, amount = 0.82): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return hex
  const num = parseInt(m[1], 16)
  const r = Math.round(((num >> 16) & 0xff) * amount)
  const g = Math.round(((num >> 8) & 0xff) * amount)
  const b = Math.round((num & 0xff) * amount)
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`
}

// The first (lowest sort_order) active banner with a real theme drives the
// site-wide accent while it's live -- simplest, most predictable rule when
// more than one themed banner could theoretically be active at once.
export function resolveSiteAccent(banners: HomeBanner[]): string | null {
  for (const b of banners) {
    const color = resolveThemeColor(b)
    if (color) return color
  }
  return null
}
