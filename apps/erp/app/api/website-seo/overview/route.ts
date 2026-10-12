import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'

// Counts only -- the dashboard's "what still needs attention" numbers.
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const head = { count: 'exact' as const, head: true }
  const [published, noDescription, noAlt, redirects, overrides, drafts, lastRevision] = await Promise.all([
    supabaseAdmin.from('sku_master').select('id', head).eq('is_published', true),
    supabaseAdmin.from('sku_master').select('id', head).eq('is_published', true).or('web_description.is.null,web_description.eq.'),
    supabaseAdmin
      .from('product_images')
      .select('id, sku_master!inner(is_published)', head)
      .eq('sku_master.is_published', true)
      .or('alt_text.is.null,alt_text.eq.'),
    supabaseAdmin.from('seo_redirects').select('id', head),
    supabaseAdmin.from('seo_overrides').select('id', head).eq('status', 'published'),
    supabaseAdmin.from('seo_overrides').select('id', head).eq('status', 'draft'),
    supabaseAdmin.from('seo_revisions').select('created_at').order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ])

  return NextResponse.json({
    published_products: published.count ?? 0,
    published_without_description: noDescription.count ?? 0,
    images_without_alt: noAlt.count ?? 0,
    redirects: redirects.count ?? 0,
    overrides_published: overrides.count ?? 0,
    overrides_draft: drafts.count ?? 0,
    last_change_at: lastRevision.data?.created_at ?? null,
  })
}
