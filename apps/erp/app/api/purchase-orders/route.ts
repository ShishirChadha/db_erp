import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { recalcPOTotals, getVendorName } from '@/lib/purchase-utils'
import { getSessionUser, isOwner, isManagerOrAbove } from '@/lib/auth/session'
import { parsePagination } from '@/lib/pagination'
import { logAuditEvent } from '@/lib/audit-log'

// Purchase Orders carry vendor/cost/GST data end-to-end -- no employee access. Managers
// may view (needed to approve/submit) but only owners can create/edit.
// ---------- GET (list) ----------
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isManagerOrAbove(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const statusRaw = searchParams.get('status')
  const vendor_id = searchParams.get('vendor_id')
  const search = searchParams.get('search')
  const exclude_invoiced = searchParams.get('exclude_invoiced') === 'true'
  const date_from = searchParams.get('date_from')
  const date_to = searchParams.get('date_to')

  // exclude_invoiced filters further in JS below (after the query), which would
  // make a SQL-level .range() page inconsistent with the reported total -- it's
  // unused by the current UI, so pagination simply doesn't apply when it's set.
  const pagination = exclude_invoiced ? null : parsePagination(searchParams)

  let query = supabaseAdmin
    .from('purchase_orders')
    .select('*', pagination ? { count: 'exact' } : undefined)
    .eq('is_deleted', false)
    .order('po_date', { ascending: false })

  if (statusRaw) {
    const statuses = statusRaw.split(',').map(s => s.trim())
    query = query.in('po_status', statuses)
  }

  if (vendor_id) query = query.eq('vendor_id', vendor_id)
  if (search) query = query.ilike('po_number', `%${search}%`)
  if (date_from) query = query.gte('po_date', date_from)
  if (date_to) query = query.lte('po_date', date_to)
  if (pagination) query = query.range(pagination.from, pagination.to)

  let { data: pos, error, count } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  // Ensure pos is an array
  pos = pos || []

  if (exclude_invoiced) {
    const { data: invoices } = await supabaseAdmin
      .from('invoices')
      .select('po_id')
      .eq('invoice_type', 'purchase')

    const invoicedIds = new Set((invoices || []).map(inv => inv.po_id).filter(Boolean))
    pos = pos.filter(po => !invoicedIds.has(po.id))
  }

  if (pagination) return NextResponse.json({ data: pos, total: count ?? 0 })
  return NextResponse.json(pos)
}

// ---------- POST (create) ----------
export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json()
  const {
    vendor_id,
    po_date,
    purchase_type,
    purchased_by_type,
    purchased_by_other,
    expected_delivery_date,
    delivery_location,
    remarks,
    items,
  } = body

  if (!vendor_id || !po_date || !items?.length) {
    return NextResponse.json(
      { error: 'vendor_id, po_date, and items required' },
      { status: 400 }
    )
  }

  // Generate PO number
  const { data: poNumber, error: numErr } = await supabaseAdmin.rpc('generate_po_number')
  if (numErr) return NextResponse.json({ error: numErr.message }, { status: 500 })

  const vendorName = await getVendorName(vendor_id)

  // Create PO header
  const { data: po, error: poErr } = await supabaseAdmin
    .from('purchase_orders')
    .insert({
      po_number: poNumber,
      po_date,
      vendor_id,
      vendor_name: vendorName,
      purchase_type: purchase_type || 'GST',
      purchased_by_type: purchased_by_type || 'Digitalbluez',
      purchased_by_other,
      expected_delivery_date,
      delivery_location,
      remarks,
      po_status: 'draft',
      created_by: sessionUser.id,
    })
    .select()
    .single()

  if (poErr) return NextResponse.json({ error: poErr.message }, { status: 500 })

  // Insert line items
  const lineItems = []
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const { data: sku } = await supabaseAdmin
      .from('sku_master')
      .select('base_sku_code, variant_number, base_cost')
      .eq('id', item.sku_id)
      .single()
    if (!sku) return NextResponse.json({ error: `SKU not found: ${item.sku_id}` }, { status: 400 })

    const basePrice = item.base_price ?? sku.base_cost
    const gstPct = item.gst_percentage ?? 18
    const unitTotal = basePrice * item.quantity
    const gstAmount = unitTotal * gstPct / 100
    const lineTotal = unitTotal + gstAmount

    lineItems.push({
      po_id: po.id,
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

  const { error: itemsErr } = await supabaseAdmin.from('purchase_order_items').insert(lineItems)
  if (itemsErr) return NextResponse.json({ error: itemsErr.message }, { status: 500 })

  await recalcPOTotals(po.id)

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'create',
    module: 'purchase_orders',
    tableName: 'purchase_orders',
    recordId: po.id,
    recordLabel: poNumber,
  })

  return NextResponse.json({ po_id: po.id, po_number: poNumber }, { status: 201 })
}