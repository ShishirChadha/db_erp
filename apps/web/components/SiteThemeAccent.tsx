'use client'

import { useEffect } from 'react'
import { darkenColor } from '@/lib/banner-themes'

// Retints the site's primary CTA color (--brand-orange, which --primary and
// every bg-brand-orange button already reference) while a themed banner is
// active, so a festival promo actually reads as festive across the storefront
// -- not just inside the banner image, which is what the scoped-to-the-banner
// version originally shipped as. Mounted once in the root layout (always
// present) rather than in HomeBanners (homepage-only) so the accent persists
// across every page, not just "/". Resets to the CSS-defined default when no
// themed banner is active.
export function SiteThemeAccent({ accentColor }: { accentColor: string | null }) {
  useEffect(() => {
    const root = document.documentElement
    if (accentColor) {
      root.style.setProperty('--brand-orange', accentColor)
      root.style.setProperty('--brand-orange-dark', darkenColor(accentColor))
    } else {
      root.style.removeProperty('--brand-orange')
      root.style.removeProperty('--brand-orange-dark')
    }
  }, [accentColor])

  return null
}
