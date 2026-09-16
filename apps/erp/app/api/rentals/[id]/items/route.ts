import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, canEditPage } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'
import { handOverUnit } from '@/lib/rentals'

// Adds another unit to a live agreement (the customer asked for one more laptop).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canEditPage(sessionUser, 'rentals')) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const body = await req.json().catch(() => null)
  const assetId = body?.asset_id
  if (!assetId) return NextResponse.json({ error: 'A unit is required.' }, { status: 400 })

  const { data: agreement } = await supabaseAdmin
    .from('rental_agreements')
    .select('id, agreement_number, status, is_deleted')
    .eq('id', id)
    .single()
  if (!agreement || agreement.is_deleted) {
    return NextResponse.json({ error: 'Rental agreement not found' }, { status: 404 })
  }
  if (agreement.status !== 'active') {
    return NextResponse.json({ error: `Cannot add units to a ${agreement.status} agreement.` }, { status: 400 })
  }

  const result = await handOverUnit(assetId, agreement.agreement_number, sessionUser.id)
  if (result.error) return NextResponse.json({ error: result.error }, { status: result.status || 400 })

  const { data: item, error: itemErr } = await supabaseAdmin
    .from('rental_agreement_items')
    .insert({ agreement_id: id, asset_id: assetId, item_status: 'on_rent' })
    .select('id')
    .single()
  if (itemErr) {
    await supabaseAdmin.from('asset_ledger').update({ status: result.priorStatus! }).eq('id', assetId)
    await supabaseAdmin.from('stock_movements').insert({
      sku_id: result.skuId!, movement_type: 'adjustment', quantity_change: 1,
      notes: `Rental ${agreement.agreement_number} add-unit rolled back`, created_by: sessionUser.id,
    })
    return NextResponse.json({ error: itemErr.message }, { status: 500 })
  }

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'update',
    module: 'rentals',
    tableName: 'rental_agreement_items',
    recordId: item.id,
    recordLabel: agreement.agreement_number,
    reason: 'Unit added to a live rental agreement',
  })

  return NextResponse.json({ success: true, id: item.id }, { status: 201 })
}
