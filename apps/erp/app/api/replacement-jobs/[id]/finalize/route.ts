import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'

// ---------- POST: owner marks a replacement job done ----------
// Inventory for a replacement -- both the swapped-in unit's sale and the swapped-out unit's
// return to QC -- is already settled at job intake (POST /api/replacement-jobs) -- this
// route only closes out the job record.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params

  const { data: job } = await supabaseAdmin
    .from('replacement_jobs')
    .select('id, status')
    .eq('id', id)
    .single()

  if (!job) return NextResponse.json({ error: 'Replacement job not found' }, { status: 404 })
  if (job.status === 'done') return NextResponse.json({ error: 'Already finalized.' }, { status: 400 })

  const { error } = await supabaseAdmin
    .from('replacement_jobs')
    .update({ status: 'done', finalized_by: sessionUser.id, finalized_at: new Date().toISOString() })
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
