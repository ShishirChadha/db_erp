import { supabaseAdmin } from './supabase/service'

// Maps sales.payment_account ('Digitalbluez'/'Techtenth'/'Cash') to the
// business_profiles.key that should issue the invoice. This is the same
// field the project already uses to track which of the business's accounts
// received payment -- reused here as the entity signal rather than adding a
// new column.
export function resolveEntityKey(paymentAccount: string | null): string {
  const key = (paymentAccount || '').trim().toLowerCase()
  return ['digitalbluez', 'techtenth', 'cash'].includes(key) ? key : 'digitalbluez'
}

export interface EntityInfo {
  is_gst_registered: boolean
  state_code: string | null
}

export interface GstClassification {
  placeOfSupplyStateCode: string | null
  isIntraState: boolean
  gstType: 'CGST_SGST' | 'IGST' | null
  subtotal: number
  totalGst: number
  cgstAmount: number
  sgstAmount: number
  igstAmount: number
}

// GST classification: same state as the entity -> CGST+SGST; different ->
// IGST. Place of supply defaults to the customer's GSTIN state code (B2B),
// falling back to the entity's own state for B2C/individual customers with
// no GSTIN on file. A non-GST entity (Techtenth/Cash) never applies tax --
// the sale's pre-computed GST amount is dropped and the full total is
// presented as a plain (non-GST) taxable value, per the confirmed business
// rule that those entities issue a Bill of Supply, not a tax invoice.
export function classifyGst(
  entity: EntityInfo,
  customerGstNumber: string | null | undefined,
  customerStateCode: string | null | undefined,
  saleBasePrice: number,
  saleGst: number,
  saleTotal: number
): GstClassification {
  const placeOfSupplyStateCode = customerGstNumber?.trim().slice(0, 2) || customerStateCode || entity.state_code || null
  const isIntraState = !!entity.state_code && entity.state_code === placeOfSupplyStateCode

  const subtotal = entity.is_gst_registered ? saleBasePrice : saleTotal
  const totalGst = entity.is_gst_registered ? saleGst : 0
  const cgstAmount = entity.is_gst_registered && isIntraState ? saleGst / 2 : 0
  const sgstAmount = entity.is_gst_registered && isIntraState ? saleGst / 2 : 0
  const igstAmount = entity.is_gst_registered && !isIntraState ? saleGst : 0
  const gstType = !entity.is_gst_registered ? null : isIntraState ? 'CGST_SGST' : 'IGST'

  return { placeOfSupplyStateCode, isIntraState, gstType, subtotal, totalGst, cgstAmount, sgstAmount, igstAmount }
}

// Resolves what an invoice_items row for this sale needs to look like
// (description, HSN, linked asset/accessory) WITHOUT inserting anything --
// separated from the actual insert so callers can validate every sale in a
// batch (all linked units/accessories still exist) before minting a real
// invoice number or creating any row.
export async function resolveSaleItemDescriptor(sale: any): Promise<{
  item_type: 'accessory' | 'asset' | 'repair'
  description: string
  hsn_code: string | null
  quantity: number
  accessory_id?: string
  ledger_asset_id?: string
  sku_id?: string
  asset_number?: string | null
  repair_job_id?: string
}> {
  if (sale.repair_job_id) {
    const { data: job } = await supabaseAdmin
      .from('repair_jobs')
      .select('job_number, problem_description')
      .eq('id', sale.repair_job_id)
      .single()
    return {
      item_type: 'repair',
      repair_job_id: sale.repair_job_id,
      description: `Repair — ${job?.problem_description || 'Service'} (Job ${job?.job_number || sale.repair_job_id})`,
      hsn_code: null,
      quantity: 1,
    }
  }

  if (sale.accessory_id) {
    // Accessories are sku_master rows like everything else (docs/decisions.md,
    // 2026-07-23) -- sale.accessory_id now points at sku_master(id), not the
    // retired accessories table.
    const { data: sku } = await supabaseAdmin
      .from('sku_master')
      .select('sku_description, full_sku_code, hsn_code')
      .eq('id', sale.accessory_id)
      .single()
    return {
      item_type: 'accessory',
      accessory_id: sale.accessory_id,
      description: sku?.sku_description || sku?.full_sku_code || 'Accessory',
      hsn_code: sku?.hsn_code || null,
      quantity: sale.accessory_quantity || 1,
    }
  }

  const { data: asset } = await supabaseAdmin
    .from('asset_ledger')
    .select('id, sku_id, asset_number')
    .eq('id', sale.asset_ledger_id)
    .single()
  if (!asset) throw new Error(`Linked unit not found for sale ${sale.id}`)

  const { data: sku } = await supabaseAdmin
    .from('sku_master')
    .select('full_sku_code, sku_description, hsn_code')
    .eq('id', asset.sku_id)
    .single()

  return {
    item_type: 'asset',
    ledger_asset_id: asset.id,
    sku_id: asset.sku_id,
    asset_number: asset.asset_number,
    description: sku?.sku_description || sku?.full_sku_code || 'Unit',
    hsn_code: sku?.hsn_code || null,
    quantity: 1,
  }
}

// Per-entity invoicing mode (Zoho transition). 'external' -> the ERP must not mint a
// number for this entity; record the Zoho number instead. Defaults to 'erp' if the
// column/row is somehow missing, so nothing silently blocks generation.
export async function getInvoicingMode(entityKey: string): Promise<'erp' | 'external'> {
  const { data } = await supabaseAdmin
    .from('business_profiles')
    .select('invoicing_mode')
    .eq('key', entityKey)
    .single()
  return data?.invoicing_mode === 'external' ? 'external' : 'erp'
}

type CreateInvoiceResult =
  | { ok: true; invoice_id: string; invoice_number: string }
  | { ok: false; error: string; status: number }

// Single orchestrator behind every sale->invoice path (single finalize, batch
// finalize, and Zoho external-record). Given one or more already-validated sales
// (exist, un-finalized, same customer + same entity), it builds one invoice with one
// item per sale, links them, and marks them finalized. The number is either supplied
// (`invoiceNumber`, for a recorded Zoho number) or minted AFTER line items are
// validated (`mintNumber`, for ERP generation) -- validating before minting is what
// keeps a bad/missing sale link from ever spending a real invoice number.
export async function createInvoiceFromSales(opts: {
  sales: any[]
  entityKey: string
  source: 'system_issued' | 'imported_zoho'
  invoiceDate: string
  userId: string
  attachmentUrls?: string[] | null
  invoiceNumber?: string
  mintNumber?: () => Promise<string>
}): Promise<CreateInvoiceResult> {
  const { sales, entityKey, source, invoiceDate, userId, attachmentUrls } = opts
  if (!sales.length) return { ok: false, error: 'No sales provided.', status: 400 }

  const customerId = sales[0].customer_id
  const { data: customer } = await supabaseAdmin
    .from('customers')
    .select('customer_name, gst_number, address, phone, email, state_code')
    .eq('id', customerId)
    .single()

  const { data: entity } = await supabaseAdmin
    .from('business_profiles')
    .select('is_gst_registered, state_code')
    .eq('key', entityKey)
    .single()
  if (!entity) return { ok: false, error: `No business profile configured for entity '${entityKey}'`, status: 500 }

  // Validate every sale's linked unit/accessory BEFORE obtaining a number.
  const descriptors: Record<string, Awaited<ReturnType<typeof resolveSaleItemDescriptor>>> = {}
  for (const sale of sales) {
    try {
      descriptors[sale.id] = await resolveSaleItemDescriptor(sale)
    } catch (err: any) {
      return { ok: false, error: err.message, status: 404 }
    }
  }

  const gstBySale = new Map(sales.map((s) => [
    s.id, classifyGst(entity, customer?.gst_number, customer?.state_code, s.sale_base_price, s.sale_gst, s.sale_total),
  ]))
  const subtotal = sales.reduce((a, s) => a + gstBySale.get(s.id)!.subtotal, 0)
  const totalGst = sales.reduce((a, s) => a + gstBySale.get(s.id)!.totalGst, 0)
  const grandTotal = sales.reduce((a, s) => a + Number(s.sale_total), 0)
  const placeOfSupply = gstBySale.get(sales[0].id)!.placeOfSupplyStateCode

  let invoiceNumber = opts.invoiceNumber
  if (!invoiceNumber && opts.mintNumber) {
    try {
      invoiceNumber = await opts.mintNumber()
    } catch (err: any) {
      return { ok: false, error: `Failed to generate invoice number: ${err.message}`, status: 500 }
    }
  }
  if (!invoiceNumber) return { ok: false, error: 'No invoice number supplied.', status: 400 }

  const { data: invoice, error: invErr } = await supabaseAdmin
    .from('invoices')
    .insert({
      invoice_number: invoiceNumber,
      invoice_date: invoiceDate,
      invoice_type: 'sales',
      entity_key: entityKey,
      customer_id: customerId,
      customer_name: customer?.customer_name || sales[0].customer_name,
      customer_gst: customer?.gst_number || null,
      customer_address: customer?.address || null,
      customer_phone: customer?.phone || null,
      customer_email: customer?.email || null,
      place_of_supply: placeOfSupply,
      subtotal,
      total_gst: totalGst,
      grand_total: grandTotal,
      total_amount: subtotal,
      gst_total: totalGst,
      status: 'approved',
      payment_status: sales.every((s) => s.payment_status === 'paid') ? 'paid' : 'pending',
      source,
      attachment_urls: attachmentUrls && attachmentUrls.length ? attachmentUrls : null,
      created_by: userId,
      approved_by: userId,
      approved_at: new Date().toISOString(),
    })
    .select('id')
    .single()
  if (invErr) return { ok: false, error: invErr.message, status: 500 }

  const itemRows = sales.map((s) => buildInvoiceItemRow(invoice.id, s, entity, gstBySale.get(s.id)!, descriptors[s.id]))
  const { error: itemsErr } = await supabaseAdmin.from('invoice_items').insert(itemRows)
  if (itemsErr) return { ok: false, error: itemsErr.message, status: 500 }

  const { error: upErr } = await supabaseAdmin
    .from('sales')
    .update({
      finalized: true,
      finalized_by: userId,
      finalized_at: new Date().toISOString(),
      invoice_id: invoice.id,
      invoice_number: invoiceNumber,
    })
    .in('id', sales.map((s) => s.id))
  if (upErr) {
    return { ok: false, error: `Invoice ${invoiceNumber} was created, but marking the sale(s) finalized failed: ${upErr.message}`, status: 500 }
  }

  return { ok: true, invoice_id: invoice.id, invoice_number: invoiceNumber }
}

// Adds more sales as extra line items on an ALREADY-EXISTING Zoho-recorded invoice --
// the append-mode counterpart to createInvoiceFromSales above. Covers the real-world
// case where Zoho issued one invoice covering several units/sales, but not all of them
// were selected together in the ERP the first time (e.g. laptops sold on the same day
// to the same customer, only one of which got recorded under the invoice number
// initially). Only ever called for a same-customer, same-entity, source='imported_zoho'
// match on the invoice number -- see the collision check in
// /api/sales/record-external-invoice, which is the only caller.
export async function appendSalesToInvoice(opts: {
  invoiceId: string
  sales: any[]
  entityKey: string
  userId: string
  attachmentUrls?: string[] | null
}): Promise<CreateInvoiceResult> {
  const { invoiceId, sales, entityKey, userId, attachmentUrls } = opts
  if (!sales.length) return { ok: false, error: 'No sales provided.', status: 400 }

  const { data: invoice } = await supabaseAdmin.from('invoices').select('*').eq('id', invoiceId).single()
  if (!invoice) return { ok: false, error: 'Invoice not found.', status: 404 }

  const customerId = sales[0].customer_id
  const { data: customer } = await supabaseAdmin
    .from('customers')
    .select('gst_number, state_code')
    .eq('id', customerId)
    .single()

  const { data: entity } = await supabaseAdmin
    .from('business_profiles')
    .select('is_gst_registered, state_code')
    .eq('key', entityKey)
    .single()
  if (!entity) return { ok: false, error: `No business profile configured for entity '${entityKey}'`, status: 500 }

  // Validate every sale's linked unit/accessory BEFORE writing anything, same as
  // createInvoiceFromSales.
  const descriptors: Record<string, Awaited<ReturnType<typeof resolveSaleItemDescriptor>>> = {}
  for (const sale of sales) {
    try {
      descriptors[sale.id] = await resolveSaleItemDescriptor(sale)
    } catch (err: any) {
      return { ok: false, error: err.message, status: 404 }
    }
  }

  const gstBySale = new Map(sales.map((s) => [
    s.id, classifyGst(entity, customer?.gst_number, customer?.state_code, s.sale_base_price, s.sale_gst, s.sale_total),
  ]))
  const addedSubtotal = sales.reduce((a, s) => a + gstBySale.get(s.id)!.subtotal, 0)
  const addedGst = sales.reduce((a, s) => a + gstBySale.get(s.id)!.totalGst, 0)
  const addedTotal = sales.reduce((a, s) => a + Number(s.sale_total), 0)

  const itemRows = sales.map((s) => buildInvoiceItemRow(invoiceId, s, entity, gstBySale.get(s.id)!, descriptors[s.id]))
  const { error: itemsErr } = await supabaseAdmin.from('invoice_items').insert(itemRows)
  if (itemsErr) return { ok: false, error: itemsErr.message, status: 500 }

  const { error: upErr } = await supabaseAdmin
    .from('sales')
    .update({
      finalized: true,
      finalized_by: userId,
      finalized_at: new Date().toISOString(),
      invoice_id: invoiceId,
      invoice_number: invoice.invoice_number,
    })
    .in('id', sales.map((s) => s.id))
  if (upErr) {
    return { ok: false, error: `Invoice ${invoice.invoice_number} was updated, but marking the sale(s) finalized failed: ${upErr.message}`, status: 500 }
  }

  // Recompute payment_status from every sale now linked to this invoice (the ones
  // already on it plus these new ones) rather than assuming -- an earlier item could
  // be 'partial' even if these new ones are 'paid', or vice versa.
  const { data: allLinkedSales } = await supabaseAdmin.from('sales').select('payment_status').eq('invoice_id', invoiceId)
  const allPaid = (allLinkedSales || []).every((s: any) => s.payment_status === 'paid')

  const mergedAttachments = attachmentUrls && attachmentUrls.length
    ? [...new Set([...(invoice.attachment_urls || []), ...attachmentUrls])]
    : invoice.attachment_urls

  const { error: invUpErr } = await supabaseAdmin
    .from('invoices')
    .update({
      subtotal: Number(invoice.subtotal) + addedSubtotal,
      total_gst: Number(invoice.total_gst) + addedGst,
      grand_total: Number(invoice.grand_total) + addedTotal,
      total_amount: Number(invoice.total_amount) + addedSubtotal,
      gst_total: Number(invoice.gst_total) + addedGst,
      payment_status: allPaid ? 'paid' : 'pending',
      attachment_urls: mergedAttachments,
    })
    .eq('id', invoiceId)
  if (invUpErr) return { ok: false, error: `Sale(s) were added, but updating the invoice totals failed: ${invUpErr.message}`, status: 500 }

  return { ok: true, invoice_id: invoiceId, invoice_number: invoice.invoice_number }
}

// Builds one full invoice_items insert row from a resolved descriptor + this
// sale's GST classification.
export function buildInvoiceItemRow(invoiceId: string, sale: any, entity: EntityInfo, gst: GstClassification, descriptor: Awaited<ReturnType<typeof resolveSaleItemDescriptor>>) {
  const gstRate = entity.is_gst_registered && sale.sale_base_price > 0
    ? Math.round((sale.sale_gst / sale.sale_base_price) * 10000) / 100
    : 0

  return {
    invoice_id: invoiceId,
    item_type: descriptor.item_type,
    accessory_id: descriptor.accessory_id || null,
    ledger_asset_id: descriptor.ledger_asset_id || null,
    sku_id: descriptor.sku_id || null,
    asset_number: descriptor.asset_number || null,
    repair_job_id: descriptor.repair_job_id || null,
    description: descriptor.description,
    hsn_code: descriptor.hsn_code,
    quantity: descriptor.quantity,
    rate: gst.subtotal / descriptor.quantity,
    gst_rate: gstRate,
    gst_type: gst.gstType,
    cgst_amount: gst.cgstAmount,
    sgst_amount: gst.sgstAmount,
    igst_amount: gst.igstAmount,
    amount: sale.sale_total,
  }
}
