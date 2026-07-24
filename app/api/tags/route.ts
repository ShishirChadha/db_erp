import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, hasPageAccess, isOwner } from '@/lib/auth/session'

// Tag names aren't sensitive, so the suggestion list is global across all
// non-deleted activities rather than scoped to what the caller can see.
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPageAccess(sessionUser, 'activities')) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { data, error } = await supabaseAdmin.from('activities').select('tags').eq('is_deleted', false)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const tagSet = new Set<string>()
  data?.forEach((activity) => {
    activity.tags?.forEach((tag: string) => tagSet.add(tag))
  })

  return NextResponse.json(Array.from(tagSet).sort())
}

// Owner-only: correct a mistyped tag (or merge it into an existing spelling) across
// every activity that uses it, or remove it entirely -- editing tags on one task at a
// time already works for the owner via PUT /api/activities/[id], but a bad tag is
// typically reused across many tasks, so fixing it needs a bulk rewrite of the array.
export async function PATCH(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Only the owner can manage tags.' }, { status: 403 })

  const { oldTag, newTag } = await req.json()
  const trimmedOld = typeof oldTag === 'string' ? oldTag.trim() : ''
  const trimmedNew = typeof newTag === 'string' ? newTag.trim() : null
  if (!trimmedOld) return NextResponse.json({ error: 'oldTag is required.' }, { status: 400 })
  if (trimmedNew === trimmedOld) return NextResponse.json({ error: 'New tag is the same as the old tag.' }, { status: 400 })

  const { data: rows, error: fetchError } = await supabaseAdmin
    .from('activities')
    .select('id, tags')
    .eq('is_deleted', false)
    .contains('tags', [trimmedOld])
  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 })

  for (const row of rows || []) {
    const current: string[] = row.tags || []
    // Renaming onto a tag that already exists on the row is a merge (dedup via Set);
    // a null newTag removes the tag from the row entirely.
    const updated = trimmedNew
      ? Array.from(new Set(current.map((t) => (t === trimmedOld ? trimmedNew : t))))
      : current.filter((t) => t !== trimmedOld)

    const { error: updateError } = await supabaseAdmin.from('activities').update({ tags: updated }).eq('id', row.id)
    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({ updated: rows?.length || 0 })
}
