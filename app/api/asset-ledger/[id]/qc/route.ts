import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'

async function getUser(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) return null
  const token = authHeader.slice(7)
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token)
  return error ? null : user
}

// ---------- GET: asset detail + existing QC checklist ----------
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const { data: asset, error: assetErr } = await supabaseAdmin
    .from('asset_ledger')
    .select(`
      id, asset_number, serial_number, status,
      qc_grade, qc_status, qc_notes, qc_by, qc_at,
      po_id, po_item_id, sku_id,
      purchase_order_items (
        sku_master ( full_sku_code, sku_description, category, brand, model_name )
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
      .select('full_sku_code, sku_description, category, brand, model_name')
      .eq('id', asset.sku_id)
      .single()
    if (sku) (asset as any).purchase_order_items = { sku_master: sku }
  }

  const { data: checks } = await supabaseAdmin
    .from('asset_qc_checks')
    .select('id, check_item, result, notes, checked_at')
    .eq('asset_id', id)
    .order('checked_at', { ascending: true })

  return NextResponse.json({ ...asset, checks: checks || [] })
}

// ---------- PUT: submit QC checklist + grade, transition status ----------
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const user = await getUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: asset } = await supabaseAdmin
    .from('asset_ledger')
    .select('status')
    .eq('id', id)
    .single()

  if (!asset || !['qc_pending', 'qc_passed', 'faulty'].includes(asset.status)) {
    return NextResponse.json(
      { error: `Cannot QC an asset in '${asset?.status}' status` },
      { status: 400 }
    )
  }

  const body = await req.json()
  const { checks, qc_grade, qc_notes } = body as {
    checks: { check_item: string; result: 'pass' | 'fail' | 'na'; notes?: string }[]
    qc_grade: string | null
    qc_notes: string | null
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
      checked_by: user.id,
    }))
  )
  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 })

  const anyFail = checks.some((c) => c.result === 'fail')
  const qcStatus = anyFail ? 'failed' : 'passed'
  const newStatus = anyFail ? 'faulty' : 'qc_passed'

  const { error: updateErr } = await supabaseAdmin
    .from('asset_ledger')
    .update({
      qc_grade: qc_grade || null,
      qc_status: qcStatus,
      qc_notes: qc_notes || null,
      qc_by: user.id,
      qc_at: new Date().toISOString(),
      status: newStatus,
    })
    .eq('id', id)

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

  return NextResponse.json({ success: true, qc_status: qcStatus, status: newStatus })
}
