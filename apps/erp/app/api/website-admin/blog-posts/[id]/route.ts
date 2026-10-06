import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'

function slugify(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const body = await req.json() as Record<string, any>
  const { title, slug, excerpt, body: postBody, status } = body

  if (status !== undefined && status !== 'draft' && status !== 'published') {
    return NextResponse.json({ error: "status must be 'draft' or 'published'" }, { status: 400 })
  }

  const { data: existing, error: fetchErr } = await supabaseAdmin
    .from('blog_posts')
    .select('status, published_at')
    .eq('id', id)
    .maybeSingle()
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 })
  if (!existing) return NextResponse.json({ error: 'Post not found' }, { status: 404 })

  const update: Record<string, unknown> = {}
  if (title !== undefined) {
    if (!String(title).trim()) return NextResponse.json({ error: 'Title cannot be empty' }, { status: 400 })
    update.title = String(title).trim()
  }
  if (slug !== undefined && String(slug).trim()) update.slug = slugify(String(slug))
  if (excerpt !== undefined) update.excerpt = excerpt?.trim() || null
  if (postBody !== undefined) {
    if (!String(postBody).trim()) return NextResponse.json({ error: 'Body cannot be empty' }, { status: 400 })
    update.body = postBody
  }
  if (status !== undefined) {
    update.status = status
    // Set published_at only on the actual draft -> published transition --
    // mirrors sku_master.published_at. An already-published post being
    // edited again keeps its original publish date; unpublishing clears it
    // (it's a "when did this go live" field, not a status timestamp).
    if (status === 'published' && existing.status !== 'published') {
      update.published_at = new Date().toISOString()
    } else if (status === 'draft') {
      update.published_at = null
    }
  }

  const { error } = await supabaseAdmin.from('blog_posts').update(update).eq('id', id)
  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'That slug is already in use by another post' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  await logAuditEvent({
    actor: { id: sessionUser!.id, email: sessionUser!.email, role: sessionUser!.role },
    actionType: 'update',
    module: 'settings',
    tableName: 'blog_posts',
    recordId: id,
    metadata: update,
  })

  return NextResponse.json({ success: true })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const { data: existing } = await supabaseAdmin.from('blog_posts').select('title').eq('id', id).maybeSingle()

  const { error } = await supabaseAdmin.from('blog_posts').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAuditEvent({
    actor: { id: sessionUser!.id, email: sessionUser!.email, role: sessionUser!.role },
    actionType: 'hard_delete',
    module: 'settings',
    tableName: 'blog_posts',
    recordId: id,
    recordLabel: existing?.title ?? null,
    restoreStatus: 'not_applicable',
  })

  return NextResponse.json({ success: true })
}
