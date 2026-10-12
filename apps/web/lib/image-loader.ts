'use client'

// next/image loader that resizes through the self-hosted Supabase Storage
// render endpoint (served behind Cloudflare, which caches each size) instead of
// Vercel's metered Image Optimization -- that quota ran out twice (see
// docs/decisions.md, 2026-09-28), which is why images used to be `unoptimized`
// and shipped at full stored size to every phone.
//
// Anything that is not a Supabase storage object URL (local /public assets) is
// returned as-is; the ?w= keeps next/image's dev check that the loader honours
// `width` quiet without changing the file served.
const OBJECT = '/storage/v1/object/public/'
const RENDER = '/storage/v1/render/image/public/'

export default function imageLoader({ src, width, quality }: { src: string; width: number; quality?: number }): string {
  const i = src.indexOf(OBJECT)
  if (i === -1) return `${src}${src.includes('?') ? '&' : '?'}w=${width}`
  return `${src.slice(0, i)}${RENDER}${src.slice(i + OBJECT.length)}?width=${width}&quality=${quality ?? 75}`
}
