import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { resolveOrCreateSku } from '@/lib/sku-resolver'
import { getSessionUser } from '@/lib/auth/session'
import { TYPE_TO_CATEGORY, resolveBrand, buildSpecifications } from '@/lib/stock-intake'

// ---------- PATCH: edit an intake entry before QC has moved it past qc_pending ----------
// The unit is already live stock (see POST /api/stock-intake), so if the corrected specs
// resolve to a different SKU, the stock_movements receipt has to move with it -- otherwise
// quantity_in_stock would stay inflated on the old SKU and never credit the new one.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const { data: existing } = await supabaseAdmin
    .from('asset_ledger')
    .select('id, source, status, sku_id, asset_number, serial_number')
    .eq('id', id)
    .single()

  if (!existing || existing.source !== 'employee_intake') {
    return NextResponse.json({ error: 'Intake entry not found' }, { status: 404 })
  }
  if (existing.status !== 'qc_pending') {
    return NextResponse.json(
      { error: `This unit is already '${existing.status}' -- edit it from the Stock detail page instead.` },
      { status: 400 }
    )
  }

  const body = await req.json()
  if (!body.type) return NextResponse.json({ error: 'Type is required.' }, { status: 400 })
  if (!body.model) return NextResponse.json({ error: 'Model is required.' }, { status: 400 })

  const category = TYPE_TO_CATEGORY[body.type] || 'OTHER'
  const specs = buildSpecifications(category, body)
  const brand = resolveBrand(body)

  let sku
  let possibleDuplicates
  try {
    const result = await resolveOrCreateSku({
      category,
      item_type: body.type,
      brand,
      model_name: body.model,
      specifications: specs,
      sku_description: `${brand} ${body.model}`.trim(),
    })
    sku = result.sku
    possibleDuplicates = result.possibleDuplicates
  } catch (err: any) {
    return NextResponse.json({ error: `Failed to resolve SKU: ${err.message}` }, { status: 500 })
  }

  const { error: updateErr } = await supabaseAdmin
    .from('asset_ledger')
    .update({
      sku_id: sku.id,
      serial_number: body.serial_number || null,
      notes: body.condition_notes || null,
      purchased_by_type: body.purchased_by_type || null,
    })
    .eq('id', id)

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

  if (sku.id !== existing.sku_id) {
    const identifier = existing.asset_number || existing.serial_number || id
    await supabaseAdmin.from('stock_movements').insert([
      {
        sku_id: existing.sku_id,
        movement_type: 'adjustment',
        quantity_change: -1,
        notes: `Corrected SKU on intake -- unit ${identifier} moved off this SKU`,
        created_by: sessionUser.id,
      },
      {
        sku_id: sku.id,
        movement_type: 'adjustment',
        quantity_change: 1,
        notes: `Corrected SKU on intake -- unit ${identifier} moved onto this SKU`,
        created_by: sessionUser.id,
      },
    ])
  }

  return NextResponse.json({ success: true, sku_id: sku.id, possible_duplicates: possibleDuplicates })
}
