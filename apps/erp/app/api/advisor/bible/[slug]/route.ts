// Read-only fetch of one Bible chapter by slug, for the advisor palette's
// "read the full chapter" deep link. Filtered to the caller's role via `audience`,
// same as the process/fallback resolvers -- an employee-visible chapter is visible
// here too, an owner-only chapter (rare, but the frontmatter supports it) is not.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser } from '@/lib/auth/session'

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { slug } = await params
  const { data, error } = await supabaseAdmin
    .from('kb_chapters')
    .select('slug, title, kind, summary, body_md, routes, updated_at')
    .eq('slug', slug)
    .contains('audience', [sessionUser.role])
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  if (!data) return NextResponse.json({ error: 'Chapter not found' }, { status: 404 })
  return NextResponse.json(data)
}
