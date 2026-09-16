// Read-only list of every Bible chapter visible to the caller's role, for DB
// Guide's index page (grouped by module client-side). Same audience-filter
// pattern as the sibling [slug]/route.ts detail route -- kb_chapters' own RLS
// is SELECT-open with no audience filtering, so this filter is the real
// boundary, not decorative. `keywords` is included here (unlike the detail
// route, which has no use for it) since this backs a client-side filter box
// and keywords carry the Hinglish synonyms that make search findable for
// non-technical staff. `body_md` stays excluded -- this is a list, not a reader.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser } from '@/lib/auth/session'

export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabaseAdmin
    .from('kb_chapters')
    .select('slug, title, kind, module, summary, routes, keywords, updated_at')
    .contains('audience', [sessionUser.role])
    .order('kind', { ascending: true })
    .order('title', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data ?? [])
}
