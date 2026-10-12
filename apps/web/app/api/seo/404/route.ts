import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@db/db/admin'

// Records an address that returned the 404 page, so the owner can see which
// dead links are actually being requested (ERP: Website SEO -> Crawl & 404s).
// Called by the not-found page in the visitor's browser. Unauthenticated by
// necessity, so it is defensive: tiny, rate-limited per path, ignores assets and
// framework paths, and the database function caps the table at 5,000 paths.
const ASSET = /\.(?:js|css|map|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|txt|xml|json|php|asp|aspx)$/i
const recent = new Map<string, number>()

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const path = typeof body.path === 'string' ? body.path.split('?')[0].split('#')[0] : ''
  const referrer = typeof body.referrer === 'string' ? body.referrer : null

  if (!path.startsWith('/') || path.length > 300 || path.startsWith('//')) return NextResponse.json({ ok: false }, { status: 400 })
  if (ASSET.test(path) || path.startsWith('/_next') || path.startsWith('/api/')) return NextResponse.json({ ok: true, ignored: true })

  const last = recent.get(path)
  if (last && Date.now() - last < 10_000) return NextResponse.json({ ok: true, ignored: true })
  recent.set(path, Date.now())
  if (recent.size > 1000) recent.clear()

  // Best-effort: a logging failure must never surface to the visitor.
  await supabaseAdmin.rpc('log_404', { p_path: path, p_referrer: referrer }).then(() => undefined, () => undefined)
  return NextResponse.json({ ok: true })
}
