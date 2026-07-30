import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logFieldCorrections } from '@/lib/field-corrections'

// ---------- POST: owner permanently deletes an asset_ledger row, including a sold one ----------
// Unlike DELETE /api/asset-ledger/[id] (which unconditionally refuses anything 'sold'),
// this route allows deleting a sold unit specifically when it has no live financial
// history left -- i.e. any sale against it has already been voided (POST .../sales/[id]/void),
// or it was never a real sale at all (test/debris data). A unit with an active
// (non-voided) sale, a PO, or a repair job still can't be deleted here -- those need
// their own resolution path first, same principle as the unconditional route.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const reason = (body.reason || '').trim()
  if (!reason) return NextResponse.json({ error: 'A reason is required to delete this unit.' }, { status: 400 })

  const { data: asset } = await supabaseAdmin
    .from('asset_ledger')
    .select('id, asset_number, serial_number, status, po_id')
    .eq('id', id)
    .single()
  if (!asset) return NextResponse.json({ error: 'Asset not found' }, { status: 404 })

  if (asset.po_id) {
    return NextResponse.json({ error: 'This asset is linked to a Purchase Order -- delete via the PO (hard-delete) instead.' }, { status: 400 })
  }

  const { data: activeSale } = await supabaseAdmin
    .from('sales')
    .select('id')
    .eq('asset_ledger_id', id)
    .eq('is_deleted', false)
    .maybeSingle()
  if (activeSale) {
    return NextResponse.json({ error: 'This unit has an active sale -- void the sale first, then delete.' }, { status: 400 })
  }

  const { data: repairJob } = await supabaseAdmin
    .from('repair_jobs')
    .select('job_number')
    .or(`asset_id.eq.${id},replacement_asset_id.eq.${id}`)
    .maybeSingle()
  if (repairJob) {
    return NextResponse.json({ error: `Linked to repair job ${repairJob.job_number} -- resolve there first.` }, { status: 400 })
  }

  // field_corrections has no FK to asset_ledger, so logging before the delete is safe
  // and preserves a trace of what existed even after the row is gone.
  await logFieldCorrections(
    'asset_ledger',
    id,
    [{ field: 'deleted', oldValue: JSON.stringify({ asset_number: asset.asset_number, serial_number: asset.serial_number, status: asset.status }), newValue: null }],
    sessionUser.id,
    reason
  )

  const { error } = await supabaseAdmin.from('asset_ledger').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
