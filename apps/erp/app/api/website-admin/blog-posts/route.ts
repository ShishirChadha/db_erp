import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'

// Owner-only authoring for apps/web's blog -- the storefront pages
// (/blog, /blog/[slug]), its JSON-LD and its sitemap entries already exist
// and read blog_posts directly (not through a public_ view, since its own
// RLS policy already restricts anon/authenticated reads to status='published'
// rows). What was missing was anywhere to actually write a post, which is
// why the table sat at 0 rows despite the storefront side being built.
function slugify(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { data, error } = await supabaseAdmin
    .from('blog_posts')
    .select('id, slug, title, excerpt, body, status, published_at, created_at, updated_at')
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json()
  const { title, slug, excerpt, body: postBody, status } = body as {
    title?: string; slug?: string; excerpt?: string | null; body?: string; status?: string
  }

  if (!title?.trim() || !postBody?.trim()) {
    return NextResponse.json({ error: 'Title and body are both required' }, { status: 400 })
  }
  const finalStatus = status === 'published' ? 'published' : 'draft'
  const finalSlug = (slug?.trim() ? slugify(slug) : slugify(title)) || `post-${Date.now()}`

  const { data, error } = await supabaseAdmin
    .from('blog_posts')
    .insert({
      title: title.trim(),
      slug: finalSlug,
      excerpt: excerpt?.trim() || null,
      body: postBody,
      status: finalStatus,
      // Set once, on the draft->published transition, same as sku_master's
      // own published_at -- never client-supplied, and never reset on a later
      // edit (PATCH leaves it untouched unless the transition happens there).
      published_at: finalStatus === 'published' ? new Date().toISOString() : null,
    })
    .select()
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'That slug is already in use by another post' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  await logAuditEvent({
    actor: { id: sessionUser!.id, email: sessionUser!.email, role: sessionUser!.role },
    actionType: 'create',
    module: 'settings',
    tableName: 'blog_posts',
    recordId: data?.id ?? null,
    recordLabel: data?.title ?? null,
  })

  return NextResponse.json(data)
}
