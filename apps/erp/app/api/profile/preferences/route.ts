import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser } from '@/lib/auth/session'

// Self-service UI preferences (theme, sidebar hide/pin/reorder) -- any signed-in
// role, not just owner. `id` always comes from the session, never the request
// body, so a caller can only ever touch their own row. Merges into the existing
// jsonb rather than overwriting wholesale so a partial update (e.g. just `theme`)
// never clobbers previously-saved nav prefs and vice versa.
export async function PATCH(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const ALLOWED_KEYS = ['theme', 'hiddenItems', 'pinnedItems', 'groupOrder']
  const patch: Record<string, unknown> = {}
  for (const key of ALLOWED_KEYS) {
    if (key in body) patch[key] = body[key]
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'No recognized preference keys in body' }, { status: 400 })
  }

  const { data: existing } = await supabaseAdmin
    .from('profiles')
    .select('ui_preferences')
    .eq('id', sessionUser.id)
    .single()

  const merged = { ...(existing?.ui_preferences || {}), ...patch }

  const { error } = await supabaseAdmin
    .from('profiles')
    .update({ ui_preferences: merged })
    .eq('id', sessionUser.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ui_preferences: merged })
}
