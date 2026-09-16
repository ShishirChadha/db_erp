import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'

// ---------- POST: owner marks an accessory replacement job done ----------
// Inventory -- both the swapped-in item's sale and the swapped-out item's return to
// stock -- is already settled at job intake (POST /api/accessory-replacement-jobs) --
// this route only closes out the job record, same as the serialized job's finalize route.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params

  const { data: job } = await supabaseAdmin
    .from('accessory_replacement_jobs')
    .select('id, status, job_number')
    .eq('id', id)
    .single()

  if (!job) return NextResponse.json({ error: 'Accessory replacement job not found' }, { status: 404 })
  if (job.status === 'done') return NextResponse.json({ error: 'Already finalized.' }, { status: 400 })

  const { error } = await supabaseAdmin
    .from('accessory_replacement_jobs')
    .update({ status: 'done', finalized_by: sessionUser.id, finalized_at: new Date().toISOString() })
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'status_change',
    module: 'replacement_jobs',
    tableName: 'accessory_replacement_jobs',
    recordId: id,
    recordLabel: job.job_number,
  })

  return NextResponse.json({ success: true })
}
