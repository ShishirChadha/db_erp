import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { logAuditEvent } from '@/lib/audit-log'
import { getSessionUser, hasPageAccess } from '@/lib/auth/session'

// ---------- POST: qc_passed -> ready_for_sale ----------
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  // Same gate as the sibling QC routes (qc, send-back-to-qc).
  const user = await getSessionUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPageAccess(user, ['live_stock', 'stock'])) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { data: asset } = await supabaseAdmin
    .from('asset_ledger')
    .select('status')
    .eq('id', id)
    .single()

  if (!asset || asset.status !== 'qc_passed') {
    return NextResponse.json(
      { error: `Only assets in 'qc_passed' status can be marked ready for sale` },
      { status: 400 }
    )
  }

  const { error } = await supabaseAdmin
    .from('asset_ledger')
    .update({ status: 'ready_for_sale' })
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAuditEvent({
    actor: { id: user.id, email: user.email, role: user.role },
    actionType: 'status_change',
    module: 'stock',
    tableName: 'asset_ledger',
    recordId: id,
    metadata: { from: 'qc_passed', to: 'ready_for_sale' },
  })

  return NextResponse.json({ success: true, status: 'ready_for_sale' })
}
