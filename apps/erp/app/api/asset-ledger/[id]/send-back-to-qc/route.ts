import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, hasPageAccess } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'

// ---------- POST: ready_for_sale -> qc_pending ----------
// A unit marked ready can turn out to need another look (a defect noticed after the
// fact) -- open to both roles, same as the rest of the QC/intake flow, not owner-only.
// Resets qc_status to 'pending' alongside status so the two never disagree; the
// previous checklist/grade are left in place as history rather than cleared.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPageAccess(sessionUser, ['live_stock', 'stock'])) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { data: asset } = await supabaseAdmin
    .from('asset_ledger')
    .select('status')
    .eq('id', id)
    .single()

  if (!asset || asset.status !== 'ready_for_sale') {
    return NextResponse.json(
      { error: `Only assets in 'ready_for_sale' status can be sent back to QC (current status: ${asset?.status})` },
      { status: 400 }
    )
  }

  const { error } = await supabaseAdmin
    .from('asset_ledger')
    .update({ status: 'qc_pending', qc_status: 'pending' })
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'status_change',
    module: 'stock',
    tableName: 'asset_ledger',
    recordId: id,
    metadata: { from: 'ready_for_sale', to: 'qc_pending' },
  })

  return NextResponse.json({ success: true, status: 'qc_pending' })
}
