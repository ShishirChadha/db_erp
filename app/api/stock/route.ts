import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, hasPageAccess } from '@/lib/auth/session'
import { redactManyForRole } from '@/lib/auth/redact'

// ---------- GET: list all assets ----------
// Used by Live Stock, Sell/Service unit search, and (owner-only) Stock/Main ERP + RMA.
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPageAccess(sessionUser, ['live_stock', 'new_entry', 'invoices'])) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const statusFilter = searchParams.get('status')      // optional
  const search = searchParams.get('search')            // optional (asset number, serial, or SKU code/brand/model/description)
  const sku_id = searchParams.get('sku_id')            // optional
  const id = searchParams.get('id')                    // optional (fetch a single unit by id)
  const source = searchParams.get('source')            // optional exact match, e.g. 'employee_intake'
  const excludeSource = searchParams.get('exclude_source') // optional not-equal, e.g. 'employee_intake'

  // purchase_order_items is a LEFT (not inner) join: legacy-door rows (source=
  // 'legacy_purchase', created directly in asset_ledger with no PO) have no
  // po_item_id, and must still show up here rather than being silently excluded.
  let query = supabaseAdmin
    .from('asset_ledger')
    .select(`
      id,
      asset_number,
      serial_number,
      status,
      qc_grade,
      qc_status,
      reserved_at,
      received_at,
      sold_at,
      po_id,
      po_item_id,
      sku_id,
      source,
      vendor_id,
      purchased_by_type,
      cost_price,
      gst_percentage,
      purchase_order_items (
        quantity,
        base_price,
        unit_price,
        gst_percentage,
        line_total,
        purchase_orders (
          po_number,
          po_date,
          vendor_name,
          purchased_by_type
        ),
        sku_master (
          full_sku_code,
          sku_description
        )
      )
    `)
    .order('asset_number')

  if (statusFilter) {
    const statuses = statusFilter.split(',').map(s => s.trim())
    query = statuses.length > 1 ? query.in('status', statuses) : query.eq('status', statuses[0])
  }
  if (search) {
    // A search term can match the asset's own tag (asset/serial number) or the
    // SKU it belongs to (code/brand/model/description, e.g. "Lenovo" or "T450") --
    // asset_ledger.sku_id is always populated regardless of PO-link status, so
    // resolving matching SKUs first and OR-ing on sku_id covers both cases.
    const { data: matchingSkus } = await supabaseAdmin
      .from('sku_master')
      .select('id')
      .or(`full_sku_code.ilike.%${search}%,sku_description.ilike.%${search}%,brand.ilike.%${search}%,model_name.ilike.%${search}%`)

    const skuIds = (matchingSkus || []).map((s) => s.id)
    const orClauses = [`asset_number.ilike.%${search}%`, `serial_number.ilike.%${search}%`]
    if (skuIds.length > 0) {
      orClauses.push(`sku_id.in.(${skuIds.join(',')})`)
    }
    query = query.or(orClauses.join(','))
  }
  if (sku_id) {
    query = query.eq('sku_id', sku_id)
  }
  if (id) {
    query = query.eq('id', id)
  }
  if (source) {
    query = query.eq('source', source)
  }
  if (excludeSource) {
    query = query.neq('source', excludeSource)
  }

  const { data: assets, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // For rows with no purchase_order_items (legacy-door entries), pull SKU and
  // vendor info via their own direct references on asset_ledger instead.
  const noPoItemRows = (assets || []).filter((a: any) => !a.purchase_order_items)
  const fallbackSkuIds = [...new Set(noPoItemRows.map((a: any) => a.sku_id).filter(Boolean))]
  const fallbackVendorIds = [...new Set(noPoItemRows.map((a: any) => a.vendor_id).filter(Boolean))]

  const [{ data: fallbackSkus }, { data: fallbackVendors }] = await Promise.all([
    fallbackSkuIds.length
      ? supabaseAdmin.from('sku_master').select('id, full_sku_code, sku_description').in('id', fallbackSkuIds)
      : Promise.resolve({ data: [] as any[] }),
    fallbackVendorIds.length
      ? supabaseAdmin.from('vendors').select('id, company_name').in('id', fallbackVendorIds)
      : Promise.resolve({ data: [] as any[] }),
  ])
  const skuById = new Map((fallbackSkus || []).map((s: any) => [s.id, s]))
  const vendorById = new Map((fallbackVendors || []).map((v: any) => [v.id, v]))

  // Sold units get their sale info merged in (customer, invoice status) -- this is
  // what makes the Sold Stock view usable as a warranty lookup, and lets the owner see
  // which sales still need an invoice, without a second page/request.
  const soldIds = (assets || []).filter((a: any) => a.status === 'sold').map((a: any) => a.id)
  const { data: salesRows } = soldIds.length
    ? await supabaseAdmin
        .from('sales')
        .select('asset_ledger_id, customer_name, sale_total, finalized, invoice_number, payment_status, amount_paid, sold_by')
        .in('asset_ledger_id', soldIds)
    : { data: [] as any[] }
  const saleByAssetId = new Map((salesRows || []).map((s: any) => [s.asset_ledger_id, s]))

  // Flatten the nested joins into a simpler structure
  const result = (assets || []).map((asset: any) => {
    const item = asset.purchase_order_items
    const po = item?.purchase_orders
    const sku = item?.sku_master || skuById.get(asset.sku_id)
    const fallbackVendor = vendorById.get(asset.vendor_id)
    const sale = saleByAssetId.get(asset.id)
    return {
      id: asset.id,
      asset_number: asset.asset_number,
      serial_number: asset.serial_number,
      status: asset.status,
      qc_grade: asset.qc_grade,
      qc_status: asset.qc_status,
      reserved_at: asset.reserved_at,
      received_at: asset.received_at,
      sold_at: asset.sold_at,
      po_id: asset.po_id,
      sku_id: asset.sku_id,
      sku_code: sku?.full_sku_code || '',
      description: sku?.sku_description || '',
      quantity: item?.quantity ?? 1,
      unit_price: item?.unit_price ?? asset.cost_price,
      gst_percentage: item?.gst_percentage ?? asset.gst_percentage,
      line_total: item?.line_total,
      po_number: po?.po_number,
      po_date: po?.po_date,
      vendor_name: po?.vendor_name || fallbackVendor?.company_name,
      purchased_by_type: po?.purchased_by_type || asset.purchased_by_type,
      customer_name: sale?.customer_name,
      sale_total: sale?.sale_total,
      invoice_finalized: sale?.finalized,
      invoice_number: sale?.invoice_number,
      payment_status: sale?.payment_status,
      amount_paid: sale?.amount_paid,
    }
  })

  return NextResponse.json(redactManyForRole(result, 'stock_list', sessionUser.role))
}

// ---------- PUT: update asset number or serial ----------
export async function PUT(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { id, asset_number, serial_number } = body

  if (!id) {
    return NextResponse.json({ error: 'Asset id is required' }, { status: 400 })
  }

  // Check current asset status
  const { data: asset, error: fetchErr } = await supabaseAdmin
    .from('asset_ledger')
    .select('status')
    .eq('id', id)
    .single()

  if (fetchErr || !asset) {
    return NextResponse.json({ error: 'Asset not found' }, { status: 404 })
  }

  // Only allow editing if asset is NOT sold or invoiced or returned
  if (['sold', 'invoiced', 'returned'].includes(asset.status)) {
    return NextResponse.json(
      { error: `Cannot edit asset in '${asset.status}' status. Only unsold assets can be edited.` },
      { status: 400 }
    )
  }

  // Prepare update object
  const updates: any = {}
  if (asset_number !== undefined) updates.asset_number = asset_number
  if (serial_number !== undefined) updates.serial_number = serial_number

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  const { error: updateErr } = await supabaseAdmin
    .from('asset_ledger')
    .update(updates)
    .eq('id', id)

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}