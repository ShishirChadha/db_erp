import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, hasPageAccess, isOwner, canEditPage } from '@/lib/auth/session'
import { redactManyForRole } from '@/lib/auth/redact'
import { findDuplicateSerial } from '@/lib/duplicate-serial'
import { logFieldCorrections } from '@/lib/field-corrections'
import { logAuditEvent } from '@/lib/audit-log'
import { parsePagination } from '@/lib/pagination'
import { resolveEntityKey } from '@/lib/invoice-finalize'
import { latestPaymentDatesBySaleId } from '@/lib/sale-payment-dates'
import { buildCustomerSummary } from '@/lib/customer-summary'

// Category spec field names (used to build the specifications->>field ILIKE clauses
// below) rarely change -- refetching all of sku_category_templates on every single
// keystroke of a search box was pure overhead. Same short-TTL in-memory cache pattern
// as lib/auth/redact.ts's redaction rules cache.
let specFieldNamesCache: string[] | null = null
let specFieldNamesCacheAt = 0
const SPEC_FIELD_CACHE_TTL_MS = 60_000

// business_profiles.invoicing_mode barely ever changes -- same short-TTL cache pattern
// as getSpecFieldNames below, so it doesn't become another unconditional query on every
// single /api/stock request (it's also skipped entirely below when nothing in this
// response is sold, since invoice_mode is meaningless without a sale to attach it to).
let invoicingModeCache: Map<string, string> | null = null
let invoicingModeCacheAt = 0
const INVOICING_MODE_CACHE_TTL_MS = 60_000

async function getInvoicingModeByKey(): Promise<Map<string, string>> {
  if (invoicingModeCache && Date.now() - invoicingModeCacheAt < INVOICING_MODE_CACHE_TTL_MS) {
    return invoicingModeCache
  }
  const { data: businessProfiles } = await supabaseAdmin.from('business_profiles').select('key, invoicing_mode')
  invoicingModeCache = new Map((businessProfiles || []).map((p: any) => [p.key, p.invoicing_mode]))
  invoicingModeCacheAt = Date.now()
  return invoicingModeCache
}

async function getSpecFieldNames(): Promise<string[]> {
  if (specFieldNamesCache && Date.now() - specFieldNamesCacheAt < SPEC_FIELD_CACHE_TTL_MS) {
    return specFieldNamesCache
  }
  const { data: specTemplates } = await supabaseAdmin
    .from('sku_category_templates')
    .select('field_schema')
  const names = new Set<string>()
  for (const t of specTemplates || []) {
    const fields = (t as any).field_schema?.fields
    if (Array.isArray(fields)) for (const f of fields) if (f?.name) names.add(f.name)
  }
  specFieldNamesCache = [...names]
  specFieldNamesCacheAt = Date.now()
  return specFieldNamesCache
}

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

  // Stat-card counts mode: SQL exact counts instead of fetching+filtering full rows.
  // The previous approach (StockView.tsx's fetchCounts) fetched every current+sold
  // row unpaginated and did .length/.filter().length in JS -- silently plateaus at
  // PostgREST's row cap once a source/status bucket exceeds it. This mirrors the
  // pattern already used correctly in /api/sku-master's counts=true branch.
  if (searchParams.get('counts') === 'true') {
    const CURRENT_STATUSES = ['draft', 'reserved', 'received', 'in_stock', 'qc_pending', 'qc_passed', 'ready_for_sale', 'faulty', 'rma_sent', 'rma_returned']
    const applySource = (q: any) => {
      if (source) q = q.eq('source', source)
      if (excludeSource) q = q.neq('source', excludeSource)
      return q
    }
    const countQuery = (extra: (q: any) => any) =>
      applySource(extra(supabaseAdmin.from('asset_ledger').select('id', { count: 'exact', head: true })))

    const [totalCurrent, readyForSale, qcPending, totalSold] = await Promise.all([
      countQuery((q) => q.in('status', CURRENT_STATUSES)),
      countQuery((q) => q.eq('status', 'ready_for_sale')),
      countQuery((q) => q.eq('status', 'qc_pending')),
      countQuery((q) => q.eq('status', 'sold')),
    ])

    const result: Record<string, number> = {
      totalCurrent: totalCurrent.count || 0,
      readyForSale: readyForSale.count || 0,
      qcPending: qcPending.count || 0,
      totalSold: totalSold.count || 0,
    }

    if (isOwner(sessionUser)) {
      // invoice_finalized isn't a real column -- it's derived at read time from a
      // join in the row-fetch path below, so "missing invoice" among sold units has
      // to be counted the same way: sold units whose asset_ledger_id never appears
      // on a finalized sale. The finalized-sales lookup itself has no `source`
      // column (that's asset_ledger's), so it's intentionally not source-scoped --
      // only the outer asset_ledger count is.
      const { data: finalizedSales } = await supabaseAdmin
        .from('sales')
        .select('asset_ledger_id')
        .eq('finalized', true)
        .not('asset_ledger_id', 'is', null)
      const finalizedAssetIds = [...new Set((finalizedSales || []).map((s: any) => s.asset_ledger_id))]

      const [missingPo, missingInvoice] = await Promise.all([
        countQuery((q) => q.in('status', CURRENT_STATUSES).is('po_id', null)),
        countQuery((q) =>
          finalizedAssetIds.length > 0
            ? q.eq('status', 'sold').not('id', 'in', `(${finalizedAssetIds.join(',')})`)
            : q.eq('status', 'sold')
        ),
      ])
      result.missingPoCount = missingPo.count || 0
      result.missingInvoiceCount = missingInvoice.count || 0
    }

    return NextResponse.json(result)
  }

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
    // Resolving the SKU-text match (which itself needs the cached spec field names
    // first) and the customer-name match are independent of each other -- run them
    // concurrently rather than as 3 sequential round trips, each of which is real
    // network latency to Supabase, not query cost (these tables are small; the old
    // sequential chain, not slow SQL, was what made a single search request add up to
    // multiple seconds and occasionally time out).
    const [skuIds, customerAssetIds] = await Promise.all([
      (async () => {
        const specFieldNames = await getSpecFieldNames()
        const specClauses = specFieldNames.map((f) => `specifications->>${f}.ilike.%${search}%`)
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
        return (matchingSkus || []).map((s) => s.id)
      })(),
      // A term can also match the customer a unit was sold to -- customer_name lives on
      // `sales`, joined in separately after this query runs (see saleByAssetId below),
      // so it has to be resolved here the same way SKU matches are: look up matching
      // sales first, then OR their asset_ledger_id into this query.
      (async () => {
        const { data: matchingSales } = await supabaseAdmin
          .from('sales')
          .select('asset_ledger_id')
          .ilike('customer_name', `%${search}%`)
          .not('asset_ledger_id', 'is', null)
        return [...new Set((matchingSales || []).map((s: any) => s.asset_ledger_id))]
      })(),
    ])

    const orClauses = [`asset_number.ilike.%${search}%`, `serial_number.ilike.%${search}%`]
    if (skuIds.length > 0) {
      orClauses.push(`sku_id.in.(${skuIds.join(',')})`)
    }
    if (customerAssetIds.length > 0) {
      orClauses.push(`id.in.(${customerAssetIds.join(',')})`)
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

  // A unit currently out for repair keeps whatever asset_ledger.status it already
  // had (repair-job creation never changes it) -- this is the only place that fact
  // is otherwise visible, so surface it as a badge here rather than a stored status.
  const assetIds = (assets || []).map((a: any) => a.id)

  // Sold units get their sale info merged in (customer, invoice status) -- this is
  // what makes the Sold Stock view usable as a warranty lookup, and lets the owner see
  // which sales still need an invoice, without a second page/request.
  const soldIds = (assets || []).filter((a: any) => a.status === 'sold').map((a: any) => a.id)

  // These five lookups are all independent of each other (each only depends on
  // `assets`/`assetIds`/`soldIds`, already computed above) -- run them concurrently
  // instead of one-by-one. Sequential round trips here (each real network latency to
  // Supabase, not query cost -- these tables are small) is what made a single Stock
  // request add up to multiple seconds and occasionally time out.
  const [
    { data: fallbackSkus },
    { data: fallbackVendors },
    { data: openRepairJobs },
    { data: salesRows },
    invoicingModeByKey,
  ] = await Promise.all([
    fallbackSkuIds.length
      ? supabaseAdmin.from('sku_master').select('id, full_sku_code, sku_description, category, specifications').in('id', fallbackSkuIds)
      : Promise.resolve({ data: [] as any[] }),
    fallbackVendorIds.length
      ? supabaseAdmin.from('vendors').select('id, company_name').in('id', fallbackVendorIds)
      : Promise.resolve({ data: [] as any[] }),
    assetIds.length
      ? supabaseAdmin.from('repair_jobs').select('asset_id, job_number').in('asset_id', assetIds).in('status', ['intake', 'in_progress'])
      : Promise.resolve({ data: [] as any[] }),
    soldIds.length
      ? supabaseAdmin
          .from('sales')
          .select('id, asset_ledger_id, customer_id, customer_name, sale_total, finalized, invoice_number, payment_status, amount_paid, sold_by, bundled_accessories, payment_account')
          .in('asset_ledger_id', soldIds)
      : Promise.resolve({ data: [] as any[] }),
    // Digitalbluez is currently in Zoho "external" invoicing mode during the
    // transition (docs/decisions.md, 2026-07-24) -- generating an ERP invoice for it
    // is blocked server-side regardless, but the Stock/Live Stock Sold tab's
    // "Generate Invoice" button didn't know that and showed the same label for every
    // entity, only failing (with a redirect-to-Sales alert) once actually clicked.
    // Same invoice_mode resolution /api/sales already does, so the button here can
    // show "Record Zoho Invoice #" upfront instead. Only fetched (and cached) when
    // there's actually a sold row in this response.
    soldIds.length ? getInvoicingModeByKey() : Promise.resolve(new Map<string, string>()),
  ])
  const skuById = new Map((fallbackSkus || []).map((s: any) => [s.id, s]))
  const vendorById = new Map((fallbackVendors || []).map((v: any) => [v.id, v]))
  const repairJobByAssetId = new Map((openRepairJobs || []).map((r: any) => [r.asset_id, r.job_number]))

  // customer_name is a snapshot frozen at sale creation -- for sales not yet finalized
  // into a GST invoice, prefer the customer's current name so a correction made on the
  // Customers tab (e.g. an employee left the company name incomplete) shows up here
  // immediately. Finalized sales keep their frozen snapshot (legal GST record).
  const unfinalizedCustomerIds = [...new Set(
    (salesRows || []).filter((s: any) => !s.finalized && s.customer_id).map((s: any) => s.customer_id)
  )]
  // Bundled accessories are stored inline on the unit's own sales row
  // (sales.bundled_accessories JSONB: [{accessory_id, quantity, unit_price}]) --
  // resolve each accessory_id to a display name in one batched lookup, same pattern
  // as /api/sales's own bundled_accessories_display.
  const bundledAccessoryIds = [...new Set(
    (salesRows || []).flatMap((s: any) => (Array.isArray(s.bundled_accessories) ? s.bundled_accessories : []).map((b: any) => b.accessory_id).filter(Boolean))
  )]
  // Every sold row's customer_id, regardless of finalized state -- unlike
  // customer_name (a frozen legal snapshot on a finalized GST invoice), this small
  // identity summary is a pure disambiguation aid (many customers share a first
  // name -- see docs/decisions.md customer-dedupe note) and should always reflect
  // the customer's current details.
  const allCustomerIds = [...new Set((salesRows || []).filter((s: any) => s.customer_id).map((s: any) => s.customer_id))]
  // All three depend on salesRows above, but not on each other -- concurrent again.
  const [{ data: liveCustomers }, { data: bundledSkus }, paymentDateBySaleId] = await Promise.all([
    allCustomerIds.length
      ? supabaseAdmin.from('customers').select('id, customer_name, type, contact_person, address_line1, address_line2, city, source').in('id', allCustomerIds)
      : Promise.resolve({ data: [] as any[] }),
    bundledAccessoryIds.length
      ? supabaseAdmin.from('sku_master').select('id, full_sku_code, sku_description').in('id', bundledAccessoryIds)
      : Promise.resolve({ data: [] as any[] }),
    latestPaymentDatesBySaleId((salesRows || []).map((s: any) => s.id)),
  ])
  const liveCustomerNameById = new Map((liveCustomers || []).map((c: any) => [c.id, c.customer_name]))
  const liveCustomerById = new Map((liveCustomers || []).map((c: any) => [c.id, c]))
  const bundledSkuById = new Map((bundledSkus || []).map((s: any) => [s.id, s]))

  const saleByAssetId = new Map((salesRows || []).map((s: any) => {
    const liveCustomer = s.customer_id ? liveCustomerById.get(s.customer_id) : null
    return [
      s.asset_ledger_id,
      {
        ...(!s.finalized && s.customer_id && liveCustomerNameById.has(s.customer_id)
          ? { ...s, customer_name: liveCustomerNameById.get(s.customer_id) }
          : s),
        customer_summary: liveCustomer ? buildCustomerSummary(liveCustomer) : null,
        bundled_accessories_display: (Array.isArray(s.bundled_accessories) ? s.bundled_accessories : []).map((b: any) => {
          const bsku = bundledSkuById.get(b.accessory_id)
          return { name: bsku?.sku_description || bsku?.full_sku_code || 'Accessory', quantity: b.quantity }
        }),
        payment_date: paymentDateBySaleId.get(s.id) || null,
      },
    ]
  }))

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
      customer_id: sale?.customer_id,
      customer_name: sale?.customer_name,
      customer_summary: sale?.customer_summary,
      sale_total: sale?.sale_total,
      invoice_finalized: sale?.finalized,
      invoice_number: sale?.invoice_number,
      invoice_mode: sale ? (invoicingModeByKey.get(resolveEntityKey(sale.payment_account)) === 'external' ? 'external' : 'erp') : undefined,
      payment_status: sale?.payment_status,
      amount_paid: sale?.amount_paid,
      payment_date: sale?.payment_date,
      bundled_accessories: sale?.bundled_accessories,
      bundled_accessories_display: sale?.bundled_accessories_display,
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
  const { id, asset_number, serial_number, created_at, notes, confirm_override, reason } = body

  if (!id) {
    return NextResponse.json({ error: 'Asset id is required' }, { status: 400 })
  }

  // Serial number has no DB-level uniqueness constraint -- hard block a correction
  // that would collide with another existing unit's serial, for everyone including
  // the owner (no confirm-and-proceed override). Same reasoning as stock-intake's
  // own duplicate check.
  if (serial_number) {
    const dup = await findDuplicateSerial(serial_number, id)
    if (dup) {
      const statusNote = dup.status === 'sold' ? ' (a SOLD unit)' : ''
      return NextResponse.json({
        error: `Serial "${serial_number}" already exists as ${dup.asset_number || 'an untagged unit'}${statusNote} (status: ${dup.status}, source: ${dup.source}). This change cannot be saved -- check Stock/QC for the existing entry first.`,
        error_code: 'duplicate_serial',
        existing: dup,
      }, { status: 409 })
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