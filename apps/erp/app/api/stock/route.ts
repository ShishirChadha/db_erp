import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, hasPageAccess, isOwner, canEditPage } from '@/lib/auth/session'
import { redactManyForRole } from '@/lib/auth/redact'
import { findDuplicateSerial, duplicateSerialMessage } from '@/lib/duplicate-serial'
import { logFieldCorrections } from '@/lib/field-corrections'
import { logAuditEvent } from '@/lib/audit-log'
import { parsePagination } from '@/lib/pagination'

// ---------- GET: list all assets ----------
// Used by Live Stock, Sell/Service unit search, and the main-ERP Stock page + RMA.
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPageAccess(sessionUser, ['live_stock', 'new_entry', 'invoices', 'stock'])) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const statusFilter = searchParams.get('status')      // optional
  const search = searchParams.get('search')            // optional (asset number, serial, or SKU code/brand/model/description)
  const sku_id = searchParams.get('sku_id')            // optional
  const id = searchParams.get('id')                    // optional (fetch a single unit by id)
  const source = searchParams.get('source')            // optional exact match, e.g. 'employee_intake'
  const excludeSource = searchParams.get('exclude_source') // optional not-equal, e.g. 'employee_intake'
  const pagination = parsePagination(searchParams, 20)

  // Sort is opt-in -- callers that don't pass it (Sell/Service pickers, RMA,
  // SearchableItemSelect, pending-tasks) keep today's exact asset_number-ascending
  // order, unchanged. Whitelisted to real, single-column, always-populated fields;
  // sku_code isn't here because it's derived/joined, not reliably orderable.
  const SORTABLE_FIELDS = new Set(['asset_number', 'status', 'created_at', 'sold_at'])
  const sortParam = searchParams.get('sort')
  const sortField = sortParam && SORTABLE_FIELDS.has(sortParam) ? sortParam : 'asset_number'
  const sortAscending = searchParams.get('order') !== 'desc'

  // Month/Year filter -- year anchors the filter (a bare month with no year is
  // ignored), month optionally narrows it to one calendar month within that year.
  // date_field picks which column it applies to: Current tab filters by when the unit
  // was entered (created_at), Sold tab by when it was sold (sold_at).
  const DATE_FILTER_FIELDS = new Set(['created_at', 'sold_at'])
  const dateFieldParam = searchParams.get('date_field')
  const dateField = dateFieldParam && DATE_FILTER_FIELDS.has(dateFieldParam) ? dateFieldParam : 'created_at'
  const monthParam = searchParams.get('month')
  const yearParam = searchParams.get('year')

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
      created_at,
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
          sku_description,
          category,
          specifications
        )
      )
    `, pagination ? { count: 'exact' } : undefined)
    // nullsFirst: false -- rows with no value for the sort field (e.g. legacy sold
    // units with no recorded sold_at) sink to the bottom regardless of direction,
    // so they never crowd out real dates from "last entry on top". A secondary
    // .order('id') is required for pagination to be stable at all: without a
    // deterministic tiebreaker, Postgres can return tied rows (e.g. many null
    // sold_at) in a different order per request, causing page 1 and page 2 to
    // silently overlap or skip rows under .range()-based pagination.
    .order(sortField, { ascending: sortAscending, nullsFirst: false })
    .order('id', { ascending: true })

  if (statusFilter) {
    const statuses = statusFilter.split(',').map(s => s.trim())
    query = statuses.length > 1 ? query.in('status', statuses) : query.eq('status', statuses[0])
  }
  if (search) {
    // A search term can match the asset's own tag (asset/serial number), the SKU
    // it belongs to (code/brand/model/description, e.g. "Lenovo" or "T450"), or a
    // spec value buried in sku_master.specifications (e.g. "16GB" RAM, "i5" CPU) --
    // asset_ledger.sku_id is always populated regardless of PO-link status, so
    // resolving matching SKUs first and OR-ing on sku_id covers all three.
    const { data: specTemplates } = await supabaseAdmin
      .from('sku_category_templates')
      .select('field_schema')
    const specFieldNames = new Set<string>()
    for (const t of specTemplates || []) {
      const fields = (t as any).field_schema?.fields
      if (Array.isArray(fields)) for (const f of fields) if (f?.name) specFieldNames.add(f.name)
    }
    const specClauses = [...specFieldNames].map((f) => `specifications->>${f}.ilike.%${search}%`)

    const { data: matchingSkus } = await supabaseAdmin
      .from('sku_master')
      .select('id')
      .or([
        `full_sku_code.ilike.%${search}%`,
        `sku_description.ilike.%${search}%`,
        `brand.ilike.%${search}%`,
        `model_name.ilike.%${search}%`,
        ...specClauses,
      ].join(','))

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
  const year = yearParam ? parseInt(yearParam, 10) : NaN
  if (!Number.isNaN(year)) {
    const month = monthParam ? parseInt(monthParam, 10) : null
    const from = month ? `${year}-${String(month).padStart(2, '0')}-01` : `${year}-01-01`
    const toYear = month ? (month === 12 ? year + 1 : year) : year + 1
    const toMonth = month ? (month === 12 ? 1 : month + 1) : 1
    const to = `${toYear}-${String(toMonth).padStart(2, '0')}-01`
    query = query.gte(dateField, from).lt(dateField, to)
  }
  if (pagination) query = query.range(pagination.from, pagination.to)

  const { data: assets, error, count } = await query

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
      ? supabaseAdmin.from('sku_master').select('id, full_sku_code, sku_description, category, specifications').in('id', fallbackSkuIds)
      : Promise.resolve({ data: [] as any[] }),
    fallbackVendorIds.length
      ? supabaseAdmin.from('vendors').select('id, company_name').in('id', fallbackVendorIds)
      : Promise.resolve({ data: [] as any[] }),
  ])
  const skuById = new Map((fallbackSkus || []).map((s: any) => [s.id, s]))
  const vendorById = new Map((fallbackVendors || []).map((v: any) => [v.id, v]))

  // A unit currently out for repair keeps whatever asset_ledger.status it already
  // had (repair-job creation never changes it) -- this is the only place that fact
  // is otherwise visible, so surface it as a badge here rather than a stored status.
  const assetIds = (assets || []).map((a: any) => a.id)
  const { data: openRepairJobs } = assetIds.length
    ? await supabaseAdmin
        .from('repair_jobs')
        .select('asset_id, job_number')
        .in('asset_id', assetIds)
        .in('status', ['intake', 'in_progress'])
    : { data: [] as any[] }
  const repairJobByAssetId = new Map((openRepairJobs || []).map((r: any) => [r.asset_id, r.job_number]))

  // Sold units get their sale info merged in (customer, invoice status) -- this is
  // what makes the Sold Stock view usable as a warranty lookup, and lets the owner see
  // which sales still need an invoice, without a second page/request.
  const soldIds = (assets || []).filter((a: any) => a.status === 'sold').map((a: any) => a.id)
  const { data: salesRows } = soldIds.length
    ? await supabaseAdmin
        .from('sales')
        .select('id, asset_ledger_id, customer_id, customer_name, sale_total, finalized, invoice_number, payment_status, amount_paid, sold_by, bundled_accessories')
        .in('asset_ledger_id', soldIds)
    : { data: [] as any[] }

  // customer_name is a snapshot frozen at sale creation -- for sales not yet finalized
  // into a GST invoice, prefer the customer's current name so a correction made on the
  // Customers tab (e.g. an employee left the company name incomplete) shows up here
  // immediately. Finalized sales keep their frozen snapshot (legal GST record).
  const unfinalizedCustomerIds = [...new Set(
    (salesRows || []).filter((s: any) => !s.finalized && s.customer_id).map((s: any) => s.customer_id)
  )]
  const { data: liveCustomers } = unfinalizedCustomerIds.length
    ? await supabaseAdmin.from('customers').select('id, customer_name').in('id', unfinalizedCustomerIds)
    : { data: [] as any[] }
  const liveCustomerNameById = new Map((liveCustomers || []).map((c: any) => [c.id, c.customer_name]))

  const saleByAssetId = new Map((salesRows || []).map((s: any) => [
    s.asset_ledger_id,
    !s.finalized && s.customer_id && liveCustomerNameById.has(s.customer_id)
      ? { ...s, customer_name: liveCustomerNameById.get(s.customer_id) }
      : s,
  ]))

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
      created_at: asset.created_at,
      po_id: asset.po_id,
      sku_id: asset.sku_id,
      sku_code: sku?.full_sku_code || '',
      description: sku?.sku_description || '',
      category: sku?.category || null,
      specifications: sku?.specifications || null,
      under_repair_job_number: repairJobByAssetId.get(asset.id) || null,
      quantity: item?.quantity ?? 1,
      unit_price: item?.unit_price ?? asset.cost_price,
      gst_percentage: item?.gst_percentage ?? asset.gst_percentage,
      line_total: item?.line_total,
      po_number: po?.po_number,
      po_date: po?.po_date,
      vendor_name: po?.vendor_name || fallbackVendor?.company_name,
      purchased_by_type: po?.purchased_by_type || asset.purchased_by_type,
      sale_id: sale?.id,
      customer_name: sale?.customer_name,
      sale_total: sale?.sale_total,
      invoice_finalized: sale?.finalized,
      invoice_number: sale?.invoice_number,
      payment_status: sale?.payment_status,
      amount_paid: sale?.amount_paid,
      bundled_accessories: sale?.bundled_accessories,
    }
  })

  const redacted = await redactManyForRole(result, 'stock_list', sessionUser.role)
  if (pagination) return NextResponse.json({ data: redacted, total: count ?? 0 })
  return NextResponse.json(redacted)
}

// ---------- PUT: update asset number or serial ----------
export async function PUT(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPageAccess(sessionUser, ['live_stock', 'stock'])) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  // Editing (any status) requires the edit grant on whichever page reached this asset --
  // view-only access to Live Stock/Main ERP Stock is not enough, closing a prior gap
  // where a current (unsold) unit's tag/date/notes could be edited by anyone with mere
  // view access.
  if (!isOwner(sessionUser) && !canEditPage(sessionUser, 'live_stock') && !canEditPage(sessionUser, 'stock')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const body = await req.json()
  const { id, asset_number, serial_number, created_at, notes, confirm_duplicate, confirm_override, reason } = body

  if (!id) {
    return NextResponse.json({ error: 'Asset id is required' }, { status: 400 })
  }

  // Serial number has no DB-level uniqueness constraint -- warn-then-confirm before
  // letting a correction silently collide with another existing unit's serial.
  if (serial_number) {
    const dup = await findDuplicateSerial(serial_number, id)
    if (dup) {
      if (dup.status === 'sold' && !isOwner(sessionUser) && !canEditPage(sessionUser, 'live_stock') && !canEditPage(sessionUser, 'stock')) {
        return NextResponse.json({
          error: `Serial "${serial_number}" already exists as a SOLD unit (${dup.asset_number || dup.id}). Please check with the owner before making this change.`,
          error_code: 'duplicate_serial_sold',
        }, { status: 409 })
      }
      if (!confirm_duplicate) {
        return NextResponse.json({
          error: duplicateSerialMessage(serial_number, dup),
          error_code: 'duplicate_serial',
          existing: dup,
        }, { status: 409 })
      }
    }
  }

  // Check current asset status
  const { data: asset, error: fetchErr } = await supabaseAdmin
    .from('asset_ledger')
    .select('status, asset_number, serial_number, created_at, notes')
    .eq('id', id)
    .single()

  if (fetchErr || !asset) {
    return NextResponse.json({ error: 'Asset not found' }, { status: 404 })
  }

  // Only allow editing if asset is NOT sold or invoiced or returned -- unless the owner
  // explicitly overrides with a reason (e.g. correcting a typo'd serial on a real sale,
  // or cleaning up test/debris data that was never a real transaction).
  if (['sold', 'invoiced', 'returned'].includes(asset.status)) {
    const canOverride = isOwner(sessionUser) || canEditPage(sessionUser, 'live_stock') || canEditPage(sessionUser, 'stock')
    if (!canOverride || !confirm_override) {
      return NextResponse.json(
        {
          error: `Cannot edit asset in '${asset.status}' status. Only unsold assets can be edited.`,
          error_code: canOverride ? 'sold_edit_requires_override' : undefined,
        },
        { status: 400 }
      )
    }
    if (!(reason || '').trim()) {
      return NextResponse.json({ error: 'A reason is required to edit a sold/invoiced/returned asset.' }, { status: 400 })
    }
  }

  // Prepare update object
  const updates: any = {}
  if (asset_number !== undefined) updates.asset_number = asset_number
  if (serial_number !== undefined) updates.serial_number = serial_number
  if (created_at !== undefined) updates.created_at = created_at
  if (notes !== undefined) updates.notes = notes

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

  const fieldCorrectionIds = await logFieldCorrections('asset_ledger', id, [
    { field: 'asset_number', oldValue: asset.asset_number, newValue: updates.asset_number ?? asset.asset_number },
    { field: 'serial_number', oldValue: asset.serial_number, newValue: updates.serial_number ?? asset.serial_number },
    ...(created_at !== undefined ? [{ field: 'created_at', oldValue: asset.created_at, newValue: updates.created_at }] : []),
    ...(notes !== undefined ? [{ field: 'notes', oldValue: asset.notes, newValue: updates.notes }] : []),
  ], sessionUser.id, reason || null)

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'update',
    module: 'stock',
    tableName: 'asset_ledger',
    recordId: id,
    recordLabel: updates.asset_number ?? asset.asset_number ?? asset.serial_number ?? id,
    fieldCorrectionIds,
    reason: reason || null,
  })

  return NextResponse.json({ success: true })
}