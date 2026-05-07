import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'

async function getUser(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) return null
  const token = authHeader.slice(7)
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token)
  return error ? null : user
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: po } = await supabaseAdmin
    .from('purchase_orders')
    .select('purchased_by_type, po_status')
    .eq('id', params.id)
    .single()

  if (!po || po.po_status !== 'draft') {
    return NextResponse.json({ error: 'PO not in draft' }, { status: 400 })
  }

  const { data: items } = await supabaseAdmin
    .from('purchase_order_items')
    .select('*')
    .eq('po_id', params.id)

  for (const item of items) {
    let prefix: string
    switch (po.purchased_by_type) {
      case 'Digitalbluez': prefix = 'DBAS'; break
      case 'Techtenth': prefix = 'TTAS'; break
      case 'Cash': prefix = 'CSAS'; break
      default: prefix = 'OTHR'; break
    }

    const { data: assets, error: rpcErr } = await supabaseAdmin.rpc('reserve_assets', {
      prefix,
      purchased_by_type: po.purchased_by_type,
      qty: item.quantity
    })
    if (rpcErr) throw rpcErr

    await supabaseAdmin
      .from('purchase_order_items')
      .update({ asset_prefix: prefix, asset_numbers_reserved: assets })
      .eq('id', item.id)

    const mappings = assets.map((asset: string) => ({
      po_id: params.id,
      po_item_id: item.id,
      sku_id: item.sku_id,
      asset_number: asset,
      status: 'reserved',
      reserved_at: new Date().toISOString()
    }))
    await supabaseAdmin.from('purchase_order_asset_mapping').insert(mappings)
  }

  await supabaseAdmin.from('purchase_orders').update({ po_status: 'submitted' }).eq('id', params.id)
  return NextResponse.json({ success: true })
}