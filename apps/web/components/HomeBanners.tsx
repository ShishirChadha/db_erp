'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import type { HomeBanner } from '@/lib/queries'
import { productImageUrl } from '@/lib/image-url'
import { resolveThemeColor } from '@/lib/banner-themes'

const ROTATE_MS = 5000
const DEFAULT_ASPECT = '1600 / 500' // fallback only for banners uploaded before dimensions were captured

function BannerSlide({ banner }: { banner: HomeBanner }) {
  const accent = resolveThemeColor(banner)
  const aspect = banner.image_width && banner.image_height
    ? `${banner.image_width} / ${banner.image_height}`
    : DEFAULT_ASPECT

  // The container's aspect-ratio now matches the uploaded image's own natural
  // dimensions (captured at upload time in the ERP), so object-cover never
  // needs to crop anything away -- a banner with a logo near the edge (or any
  // other shape) displays in full, edge-to-edge, instead of being force-fit
  // into a fixed ratio.
  const content = (
    <div className="relative w-full overflow-hidden bg-muted" style={{ aspectRatio: aspect }}>
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
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    if (banners.length < 2 || paused) return
    const timer = setInterval(() => setIndex((i) => (i + 1) % banners.length), ROTATE_MS)
    return () => clearInterval(timer)
  }, [banners.length, paused])

  if (banners.length === 0) return null

  const goTo = (i: number) => setIndex((i + banners.length) % banners.length)

  return (
    // Full-bleed (no max-width/side padding) -- a hero banner strip reads as a
    // hero, not another content-column item, and it's what makes "full width"
    // actually mean the full browser width rather than the site's ~1152px
    // content column.
    <section
      className="relative w-full"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <BannerSlide banner={banners[index]} />

      {banners.length > 1 && (
        <>
          <button
            type="button"
            aria-label="Previous banner"
            onClick={() => goTo(index - 1)}
            className="absolute left-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-white transition-colors hover:bg-black/60 sm:left-4"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <button
            type="button"
            aria-label="Next banner"
            onClick={() => goTo(index + 1)}
            className="absolute right-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-white transition-colors hover:bg-black/60 sm:right-4"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>

          <div className="absolute inset-x-0 bottom-3 flex justify-center gap-1.5">
            {banners.map((b, i) => (
              <button
                key={b.id}
                type="button"
                aria-label={`Show banner ${i + 1}`}
                onClick={() => goTo(i)}
                className={`h-1.5 rounded-full transition-all ${i === index ? 'w-6 bg-white' : 'w-1.5 bg-white/50'}`}
              />
            ))}
          </div>
        </>
      )}
    </section>
  )
}
