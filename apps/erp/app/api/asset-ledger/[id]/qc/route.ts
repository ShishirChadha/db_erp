import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser } from '@/lib/auth/session'

// ---------- GET: asset detail + existing QC checklist ----------
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  // This route uses supabaseAdmin (service role, bypasses RLS), so it must
  // enforce staff-only access itself -- getSessionUser() resolves to null for
  // anyone without an active `profiles` row, which is exactly a staff check
  // (web customers only ever have a `customer_profiles` row).
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: asset, error: assetErr } = await supabaseAdmin
    .from('asset_ledger')
    .select(`
      id, asset_number, serial_number, status,
      qc_grade, qc_status, qc_notes, qc_by, qc_at,
      warranty_type, warranty_start_date, warranty_duration_months, warranty_expiry_date,
      battery_health_percent, estimated_backup_hours,
      screen_condition, keyboard_condition, body_condition, included_accessories,
      po_id, po_item_id, sku_id,
      purchase_order_items (
        sku_master ( full_sku_code, sku_description, category, brand, model_name, specifications )
      )
    `)
    .eq('id', id)
    .single()

  if (assetErr || !asset) {
    return NextResponse.json({ error: 'Asset not found' }, { status: 404 })
  }

  // Legacy-door rows have no purchase_order_items link -- fall back to the SKU
  // directly referenced on the ledger row itself.
  if (!(asset as any).purchase_order_items && asset.sku_id) {
    const { data: sku } = await supabaseAdmin
      .from('sku_master')
      .select('full_sku_code, sku_description, category, brand, model_name, specifications')
      .eq('id', asset.sku_id)
      .single()
    if (sku) (asset as any).purchase_order_items = { sku_master: sku }
  }

  const { data: checks } = await supabaseAdmin
    .from('asset_qc_checks')
    .select('id, check_item, result, notes, checked_at')
    .eq('asset_id', id)
    .order('checked_at', { ascending: true })

  // Surfaced so the asset detail page can offer a "Sale Details" edit panel for
  // sold/invoiced/returned units without a second round trip.
  let saleId: string | null = null
  if (['sold', 'invoiced', 'returned'].includes(asset.status)) {
    const { data: saleRow } = await supabaseAdmin
      .from('sales')
      .select('id')
      .eq('asset_ledger_id', id)
      .eq('is_deleted', false)
      .maybeSingle()
    saleId = saleRow?.id ?? null
  }

  return NextResponse.json({ ...asset, checks: checks || [], sale_id: saleId })
}

// ---------- PUT: submit QC checklist + grade, transition status ----------
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: asset } = await supabaseAdmin
    .from('asset_ledger')
    .select('status, warranty_type, warranty_start_date')
    .eq('id', id)
    .single()

  if (!asset || !['qc_pending', 'qc_passed', 'faulty'].includes(asset.status)) {
    return NextResponse.json(
      { error: `Cannot QC an asset in '${asset?.status}' status` },
      { status: 400 }
    )
  }

  const body = await req.json()
  const {
    checks, qc_grade, qc_notes,
    battery_health_percent, estimated_backup_hours,
    screen_condition, keyboard_condition, body_condition, included_accessories,
    warranty_duration_months,
  } = body as {
    checks: { check_item: string; result: 'pass' | 'fail' | 'na'; notes?: string }[]
    qc_grade: string | null
    qc_notes: string | null
    battery_health_percent?: number | null
    estimated_backup_hours?: number | null
    screen_condition?: string | null
    keyboard_condition?: string | null
    body_condition?: string | null
    included_accessories?: string | null
    warranty_duration_months?: number | null
  }

  if (!checks || checks.length === 0) {
    return NextResponse.json({ error: 'At least one checklist item is required' }, { status: 400 })
  }

  // Replace any prior checklist for this asset with this submission
  await supabaseAdmin.from('asset_qc_checks').delete().eq('asset_id', id)

  const { error: insertErr } = await supabaseAdmin.from('asset_qc_checks').insert(
    checks.map((c) => ({
      asset_id: id,
      check_item: c.check_item,
      result: c.result,
      notes: c.notes || null,
      checked_by: sessionUser.id,
    }))
  )
  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 })

  const anyFail = checks.some((c) => c.result === 'fail')
  const qcStatus = anyFail ? 'failed' : 'passed'
  const newStatus = anyFail ? 'faulty' : 'qc_passed'

  // The compute_warranty_expiry trigger only fires off warranty_start_date +
  // warranty_duration_months -- set a start date (today, if none already on
  // file) whenever a duration is being recorded, so warranty_expiry_date
  // actually gets computed rather than silently staying NULL.
  const warrantyUpdate: Record<string, unknown> = {}
  if (warranty_duration_months !== undefined) {
    warrantyUpdate.warranty_duration_months = warranty_duration_months
    if (warranty_duration_months != null) {
      warrantyUpdate.warranty_start_date = asset.warranty_start_date || new Date().toISOString().slice(0, 10)
      if (!asset.warranty_type) warrantyUpdate.warranty_type = 'in_house'
    }
  }

  const { error: updateErr } = await supabaseAdmin
    .from('asset_ledger')
    .update({
      qc_grade: qc_grade || null,
      qc_status: qcStatus,
      qc_notes: qc_notes || null,
      qc_by: sessionUser.id,
      qc_at: new Date().toISOString(),
      status: newStatus,
      battery_health_percent: battery_health_percent ?? null,
      estimated_backup_hours: estimated_backup_hours ?? null,
      screen_condition: screen_condition || null,
      keyboard_condition: keyboard_condition || null,
      body_condition: body_condition || null,
      included_accessories: included_accessories || null,
      ...warrantyUpdate,
    })
    .eq('id', id)

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

  return NextResponse.json({ success: true, qc_status: qcStatus, status: newStatus })
}
