import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { recalcPOTotals } from '@/lib/purchase-utils'
import { getSessionUser, isOwner, isManagerOrAbove } from '@/lib/auth/session'
import { isSerializedCategory } from '@/lib/sku-categories'
import { logAuditEvent } from '@/lib/audit-log'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!isManagerOrAbove(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params

  // Fetch PO header
  const { data: po, error: poErr } = await supabaseAdmin
    .from('purchase_orders')
    .select('*')
    .eq('id', id)
    .single()

  if (poErr || !po) {
    return NextResponse.json({ error: 'Purchase Order not found' }, { status: 404 })
  }

  // Fetch line items with SKU details
  const { data: items } = await supabaseAdmin
    .from('purchase_order_items')
    .select('*, sku:sku_master ( full_sku_code, sku_description, brand, model_name, specifications, hsn_code, category )')
    .eq('po_id', id)
    .order('line_item_number', { ascending: true })

  // Fetch all asset mappings for this PO to get the current asset numbers
  const { data: allAssets } = await supabaseAdmin
    .from('asset_ledger')
    .select('po_item_id, asset_number, serial_number, status')
    .eq('po_id', id)

  // Group assets by po_item_id
  const assetsByItem: Record<string, any[]> = {}
  allAssets?.forEach(asset => {
    if (!assetsByItem[asset.po_item_id]) assetsByItem[asset.po_item_id] = []
    assetsByItem[asset.po_item_id].push(asset)
  })

  // Received quantity for fungible lines is derived from their receipt movements
  // (serialized lines derive it from their serial_numbers array instead).
  const { data: receiptMovements } = await supabaseAdmin
    .from('stock_movements')
    .select('po_item_id, quantity_change')
    .eq('po_id', id)
    .eq('movement_type', 'receipt')
  const receivedByItem: Record<string, number> = {}
  receiptMovements?.forEach(m => {
    if (!m.po_item_id) return
    receivedByItem[m.po_item_id] = (receivedByItem[m.po_item_id] || 0) + m.quantity_change
  })

  // Enrich items with SKU data and live asset numbers
  const enrichedItems = (items || []).map((item: any) => {
    const liveAssets = assetsByItem[item.id] || []
    const serials = liveAssets.filter(a => a.serial_number).map(a => a.serial_number)
    const serialized = isSerializedCategory(item.sku?.category)
    return {
      ...item,
      sku_code: item.sku?.full_sku_code || item.base_sku_code,
      sku_description: item.sku?.sku_description || '',
      sku_brand: item.sku?.brand || '',
      sku_model: item.sku?.model_name || '',
      sku_specs: item.sku?.specifications || {},
      sku_category: item.sku?.category || null,
      is_serialized: serialized,
      hsn_code: item.sku?.hsn_code || item.hsn_code || '',
      asset_numbers_reserved: liveAssets.map(a => a.asset_number),  // live list (serialized only)
      serial_numbers: serials, // updated serials (serialized only)
      received_quantity: serialized ? serials.length : (receivedByItem[item.id] || 0),
    }
  })

  return NextResponse.json({
    ...po,
    items: enrichedItems,
  })
}

// ---------- PUT (update – only draft) ----------
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const body = await req.json()

  // Only allow editing draft POs
  const { data: po } = await supabaseAdmin
    .from('purchase_orders')
    .select('po_status')
    .eq('id', id)
    .single()

  if (!po || po.po_status !== 'draft') {
    return NextResponse.json({ error: 'Only draft POs can be edited' }, { status: 400 })
  }

  const { items, po_status, ...headerFields } = body

  // If po_status is 'cancelled', allow cancellation even if not draft (but from draft/submitted)
  if (po_status === 'cancelled') {
    if (!['draft', 'submitted'].includes(po.po_status)) {
      return NextResponse.json({ error: 'Only draft or submitted POs can be cancelled' }, { status: 400 })
    }
    await supabaseAdmin
      .from('purchase_orders')
      .update({ po_status: 'cancelled' })
      .eq('id', id)

    await logAuditEvent({
      actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
      actionType: 'status_change',
      module: 'purchase_orders',
      tableName: 'purchase_orders',
      recordId: id,
      metadata: { from: po.po_status, to: 'cancelled' },
    })

    return NextResponse.json({ success: true })
  }

  // Update allowed header fields
  const allowedHeaderFields = [
    'vendor_id',
    'vendor_name',
    'po_date',
    'purchase_type',
    'purchased_by_type',
    'purchased_by_other',
    'expected_delivery_date',
    'delivery_location',
    'remarks',
    'terms_and_conditions',
    'expense_amount',
    'expense_description',
  ]
  const headerUpdate: any = {}
  for (const key of allowedHeaderFields) {
    if (headerFields[key] !== undefined) headerUpdate[key] = headerFields[key]
  }
  if (Object.keys(headerUpdate).length > 0) {
    await supabaseAdmin.from('purchase_orders').update(headerUpdate).eq('id', id)
  }

  // Replace line items if provided
  if (items && Array.isArray(items)) {
    await supabaseAdmin.from('purchase_order_items').delete().eq('po_id', id)

    const lineItems = []
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      const { data: sku } = await supabaseAdmin
        .from('sku_master')
        .select('base_sku_code, variant_number, base_cost')
        .eq('id', item.sku_id)
        .single()
      if (!sku) throw new Error(`SKU not found: ${item.sku_id}`)

      const basePrice = item.base_price ?? sku.base_cost
      const gstPct = item.gst_percentage ?? 18
      const unitTotal = basePrice * item.quantity
      const gstAmount = unitTotal * gstPct / 100
      const lineTotal = unitTotal + gstAmount

      lineItems.push({
        po_id: id,
        line_item_number: i + 1,
        sku_id: item.sku_id,
        base_sku_code: sku.base_sku_code,
        variant_number: sku.variant_number,
        quantity: item.quantity,
        base_price: basePrice,
        unit_price: basePrice,
        gst_percentage: gstPct,
        gst_amount: gstAmount,
        line_total: lineTotal,
        asset_prefix: '',
        asset_numbers_reserved: [],
        notes: item.notes || '',
      })
    }
    await supabaseAdmin.from('purchase_order_items').insert(lineItems)
    await recalcPOTotals(id)
  }

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'update',
    module: 'purchase_orders',
    tableName: 'purchase_orders',
    recordId: id,
  })

  return NextResponse.json({ success: true })
}

// ---------- DELETE (soft delete) ----------
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params

  const { data: po } = await supabaseAdmin
    .from('purchase_orders')
    .select('po_number')
    .eq('id', id)
    .single()

  // Soft delete
  await supabaseAdmin
    .from('purchase_orders')
    .update({ is_deleted: true })
    .eq('id', id)

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'soft_delete',
    module: 'purchase_orders',
    tableName: 'purchase_orders',
    recordId: id,
    recordLabel: po?.po_number || id,
    restoreStatus: 'restorable',
  })

  return NextResponse.json({ success: true })
}