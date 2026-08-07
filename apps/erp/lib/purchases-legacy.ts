import { supabaseAdmin } from './supabase/service'

export { TYPE_TO_CATEGORY } from './sku-category-map'

export function resolveBrand(body: { brand?: string; brand_other?: string }): string {
  return body.brand === 'Other' ? body.brand_other || 'Other' : body.brand || ''
}

// Builds the sku_master.specifications payload from the legacy form's flat fields,
// per category -- field names must match what each category's field_schema/
// sku_code_format expects (see sku_category_templates).
export function buildSpecifications(category: string, body: any): Record<string, any> {
  const brand = resolveBrand(body)
  switch (category) {
    case 'LAP':
      return {
        brand,
        model: body.model,
        cpu: body.cpu,
        generation: body.generation,
        ram: body.ram,
        ssd: body.ssd,
        // Omitted (not just empty) when blank -- most existing laptop SKUs predate this
        // field and have no `gpu` key at all; a blank submission must canonically match
        // them (see canonicalJson in lib/sku-resolver.ts) rather than spawn a spurious
        // duplicate variant the first time someone logs that model again.
        ...(body.gpu ? { gpu: body.gpu } : {}),
        screen_size: body.screen_size,
        model_year: body.model_year,
      }
    case 'MON':
      return { brand, size: body.screen_size }
    case 'TAB':
      return {
        brand,
        model: body.model,
        screen_size: body.screen_size,
        storage: body.ssd,
        ram: body.ram,
      }
    // A Stock Intake "Type" that isn't one of the known ones (Laptop/Desktop/Monitor/
    // Tablet/Tiny) falls through to this catch-all category (see TYPE_TO_CATEGORY's
    // `|| 'OTHER'` fallback) -- sku_category_templates already has an 'OTHER' row with
    // its own field shape (item_name/description/specs), distinct from every other
    // category's spec fields, so it needs its own case rather than falling into DES's.
    case 'OTHER':
      return { brand, item_name: body.model }
    case 'DES':
    default:
      return { brand, model: body.model, cpu: body.cpu, ram: body.ram, ssd: body.ssd, ...(body.gpu ? { gpu: body.gpu } : {}), model_year: body.model_year }
  }
}

export function getAssetPrefix(purchasedByType: string, purchasedByOther?: string | null): string {
  switch (purchasedByType) {
    case 'Digitalbluez': return 'DBAS'
    case 'Techtenth': return 'TTAS'
    case 'Cash': return 'CSAS'
    case 'Other': return purchasedByOther ? purchasedByOther.toUpperCase().slice(0, 4) : 'OTHR'
    default: return 'DBAS'
  }
}

// The legacy form's manual QC/readiness field maps onto the shared ledger's status
// vocabulary. No checklist has actually been run through this door, so qc_status
// stays at its 'pending' default regardless -- this only reflects the user's initial
// manual assessment, not a completed QC pass.
export function mapStatusPurchaseToLedgerStatus(statusPurchase: string | undefined): string {
  switch (statusPurchase) {
    case 'Ready for Sale': return 'ready_for_sale'
    case 'Faulty': return 'faulty'
    case 'QC Pending':
    case 'Other':
    default: return 'qc_pending'
  }
}

export async function updateVendorInvoiceTotal(vendorId: string | null | undefined, invoiceNumber: string | null | undefined) {
  if (!vendorId || !invoiceNumber) return
  const { data } = await supabaseAdmin
    .from('purchases')
    .select('total_price')
    .eq('vendor_id', vendorId)
    .eq('purchased_invoice_number', invoiceNumber)
    .eq('is_deleted', false)

  const totalSum = (data || []).reduce((sum, row: any) => sum + (row.total_price || 0), 0)

  await supabaseAdmin
    .from('purchases')
    .update({ vendor_invoice_total: totalSum })
    .eq('vendor_id', vendorId)
    .eq('purchased_invoice_number', invoiceNumber)
    .eq('is_deleted', false)
}

// Fields collected by the legacy quick-entry form that live on the `purchases` row
// (purchase-event detail: invoice/expense/photo/remarks/full spec display) rather than
// on the shared asset_ledger row (which only tracks per-unit lifecycle + SKU-level
// specs already live on sku_master). purchases.vendor_name/model/asset_description
// etc. are intentionally kept as a rich companion record -- see lib/sku-resolver.ts
// for the SKU-catalog side of this split.
export function buildPurchaseRecord(body: any, opts: {
  assetNumber: string | null
  serialNumber: string
  skuFullCode: string
  brand: string
  status: 'draft' | 'submitted'
}) {
  return {
    entry_date: body.entry_date || new Date().toISOString().slice(0, 10),
    purchase_date: body.purchase_date,
    vendor_id: body.vendor_id,
    vendor_name: body.vendor_name,
    type: body.type,
    brand: opts.brand,
    brand_other: body.brand === 'Other' ? body.brand_other : null,
    model: body.model,
    make_year: body.make_year,
    sku: opts.skuFullCode,
    asset_description: body.asset_description,
    cpu: body.cpu,
    generation: body.generation,
    ram: body.ram,
    ssd: body.ssd,
    screen_size: body.screen_size,
    charger: !!body.charger,
    monitor_size: body.monitor_size,
    has_keyboard: !!body.has_keyboard,
    has_mouse: !!body.has_mouse,
    base_price: body.base_price,
    gst: body.gst,
    gst_amount: body.gst_amount,
    total_price: body.total_price ?? body.base_price ?? 0,
    selling_price: body.selling_price,
    purchase_type: body.purchase_type === 'GST' ? 'GST' : 'Cash',
    purchased_invoice_number: body.purchased_invoice_number,
    eway_bill_no: body.eway_bill_no,
    expense: !!body.expense,
    expense_amount: body.expense_amount,
    expense_description: body.expense_description,
    stock_status: body.stock_status || 'In Stock',
    status_purchase: body.status_purchase || 'QC Pending',
    status_other: body.status_purchase === 'Other' ? body.status_other : null,
    purchased_by_type: body.purchased_by_type,
    purchased_by_other: body.purchased_by_type === 'Other' ? body.purchased_by_other : null,
    remarks: body.remarks,
    public_photo_url: body.public_photo_url,
    status: opts.status,
    submitted_at: opts.status === 'submitted' ? new Date().toISOString() : null,
    is_deleted: false,
    asset_number: opts.assetNumber,
    serial_number: opts.serialNumber,
  }
}
