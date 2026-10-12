// The one place the storefront's public origin is resolved. It used to be
// re-read (with a localhost fallback) in four separate files, so a missing
// env var in production would have silently pointed canonicals, the sitemap,
// OG tags and JSON-LD at http://localhost:3001.
function resolveSiteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim()
  if (configured) return configured.replace(/\/+$/, '')
  // Fail the real production deploy loudly; local dev/builds and previews keep
  // the localhost fallback so they are not blocked.
  if (process.env.VERCEL_ENV === 'production') {
    throw new Error('NEXT_PUBLIC_SITE_URL must be set for production builds')
  }
  return 'http://localhost:3001'
}

export const SITE_URL = resolveSiteUrl()

// Turns a site-relative path ("/laptops", "/product/x") into an absolute URL,
// for JSON-LD, which must not contain relative URLs.
export function absoluteUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path
  return path === '/' ? SITE_URL : `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`
}
