import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { recalcPOTotals } from '@/lib/purchase-utils'

async function getUser(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) return null
  const token = authHeader.slice(7)
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token)
  return error ? null : user
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: po, error } = await supabaseAdmin
    .from('purchase_orders')
    .select('*, items:purchase_order_items(*)')
    .eq('id', params.id)
    .single()
  if (error || !po) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(po)
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Only draft POs can be edited
  const { data: po } = await supabaseAdmin
    .from('purchase_orders')
    .select('po_status')
    .eq('id', params.id)
    .single()
  if (!po || po.po_status !== 'draft') return NextResponse.json({ error: 'Only draft POs can be edited' }, { status: 400 })

  const body = await req.json()
  const { items, ...headerFields } = body

  // Update allowed header fields
  const updatable = [
    'vendor_id','vendor_name','po_date','purchase_type','purchased_by_type',
    'purchased_by_other','expected_delivery_date','delivery_location','remarks',
    'terms_and_conditions','expense_amount','expense_description'
  ]
  const headerUpdate: any = {}
  for (const key of updatable) {
    if (headerFields[key] !== undefined) headerUpdate[key] = headerFields[key]
  }
  if (Object.keys(headerUpdate).length > 0) {
    await supabaseAdmin.from('purchase_orders').update(headerUpdate).eq('id', params.id)
  }

  // Replace line items if provided
  if (items && Array.isArray(items)) {
    await supabaseAdmin.from('purchase_order_items').delete().eq('po_id', params.id)

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
        po_id: params.id,
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
        notes: item.notes || ''
      })
    }
    await supabaseAdmin.from('purchase_order_items').insert(lineItems)
    await recalcPOTotals(params.id)
  }

  return NextResponse.json({ success: true })
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await supabaseAdmin.from('purchase_orders').update({ is_deleted: true }).eq('id', params.id)
  return NextResponse.json({ success: true })
}