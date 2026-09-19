'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import type { HomeBanner } from '@/lib/queries'
import { productImageUrl } from '@/lib/image-url'

// Per-theme accent color -- drives only this banner's own CTA/label styling
// (via an inline CSS var scoped to the banner's own container), never the
// site's global colors. A temporary festival/sale promo shouldn't repaint
// unrelated pages/components for a feature the owner touches a few times a
// year; the festive feel comes from the banner's own image + accent + CTA.
const THEME_COLORS: Record<HomeBanner['theme'], string | null> = {
  default: null,
  diwali: '#D4A017',
  christmas: '#1E7145',
  sale: '#1D4ED8',
  custom: null, // resolved per-banner from custom_color instead
}

const ROTATE_MS = 5000

function BannerSlide({ banner }: { banner: HomeBanner }) {
  const accent = banner.theme === 'custom' ? banner.custom_color : THEME_COLORS[banner.theme]

  const content = (
    // Fixed aspect-ratio + object-cover -- displays correctly regardless of the
    // uploaded image's exact pixel dimensions (auto-crops to fill rather than
    // distorting or breaking layout), so the ERP's recommended-size hint is a
    // recommendation, not a hard requirement.
    <div
      className="relative w-full overflow-hidden rounded-xl bg-muted"
      style={{ aspectRatio: '1600 / 500', ...(accent ? { ['--banner-accent' as string]: accent } : {}) }}
    >
      <Image src={productImageUrl(banner.image_path)} alt={banner.title || ''} fill sizes="100vw" className="object-cover" priority />
      {banner.title && (
        <div className="absolute inset-0 flex items-end bg-gradient-to-t from-black/60 via-black/10 to-transparent p-4 sm:p-6">
          <span
            className="rounded-full px-4 py-2 text-sm font-bold text-white shadow sm:text-base"
            style={{ backgroundColor: accent || 'var(--brand-orange)' }}
          >
            {banner.title}
          </span>
        </div>
      )}
    </div>
  )

  return banner.link_url ? (
    <Link href={banner.link_url} className="block">{content}</Link>
  ) : (
    content
  )
}

export function HomeBanners({ banners }: { banners: HomeBanner[] }) {
  const [index, setIndex] = useState(0)

  useEffect(() => {
    if (banners.length < 2) return
    const timer = setInterval(() => setIndex((i) => (i + 1) % banners.length), ROTATE_MS)
    return () => clearInterval(timer)
  }, [banners.length])

  if (banners.length === 0) return null

  return (
    <section className="mx-auto max-w-6xl px-4 pt-6 sm:px-6 lg:px-8">
      <BannerSlide banner={banners[index]} />
      {banners.length > 1 && (
        <div className="mt-3 flex justify-center gap-1.5">
          {banners.map((b, i) => (
            <button
              key={b.id}
              type="button"
              aria-label={`Show banner ${i + 1}`}
              onClick={() => setIndex(i)}
              className={`h-1.5 rounded-full transition-all ${i === index ? 'w-6 bg-brand-orange' : 'w-1.5 bg-border'}`}
            />
          ))}
        </div>
      )}
    </section>
  )
}
