import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, hasPageAccess, canEditPage } from '@/lib/auth/session'
import { mintSalesDocumentNumber, computeLineGst } from '@/lib/sales-documents'
import { parsePagination } from '@/lib/pagination'
import { logAuditEvent } from '@/lib/audit-log'

// ---------- GET: list quotations/proformas ----------
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!hasPageAccess(sessionUser, 'quotations')) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const docType = searchParams.get('doc_type')
  const showDeleted = searchParams.get('show_deleted') === 'true'

  const pagination = parsePagination(searchParams)
  let query = supabaseAdmin
    .from('sales_documents')
    .select('*, sales_document_items(id, converted)', pagination ? { count: 'exact' } : undefined)
    .order('document_date', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })

  if (docType) query = query.eq('doc_type', docType)
  if (!showDeleted) query = query.eq('is_deleted', false)
  if (pagination) query = query.range(pagination.from, pagination.to)

  const { data, error, count } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  if (pagination) return NextResponse.json({ data, total: count ?? 0 })
  return NextResponse.json(data)
}

// ---------- POST: create a quotation or proforma ----------
// A non-committal price offer (quotation) or provisional-not-tax invoice
// (proforma). Never touches inventory or mints a real invoice number --
// only conversion (via the Sell page, per line) does that.
export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canEditPage(sessionUser, 'quotations')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const body = await req.json()
  const { doc_type, entity_key, customer_id, valid_until, notes, terms_conditions, items } = body

  if (!['quotation', 'proforma'].includes(doc_type)) {
    return NextResponse.json({ error: "doc_type must be 'quotation' or 'proforma'" }, { status: 400 })
  }
  if (!customer_id) return NextResponse.json({ error: 'customer_id is required' }, { status: 400 })
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: 'At least one line item is required' }, { status: 400 })
  }

  const { data: entity } = await supabaseAdmin
    .from('business_profiles')
    .select('is_gst_registered, state_code')
    .eq('key', entity_key)
    .single()
  if (!entity) return NextResponse.json({ error: `No business profile configured for entity '${entity_key}'` }, { status: 400 })

  const { data: customer } = await supabaseAdmin
    .from('customers')
    .select('customer_name, gst_number, address, phone, email, state_code')
    .eq('id', customer_id)
    .single()
  if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

  const placeOfSupplyStateCode = customer.gst_number?.trim().slice(0, 2) || customer.state_code || entity.state_code || null

  const computedItems = items.map((item: any) => {
    const quantity = Number(item.quantity) || 1
    const rate = Number(item.rate) || 0
    const lineAmount = quantity * rate
    const gst = computeLineGst(entity, placeOfSupplyStateCode, lineAmount, Number(item.gst_rate) || 0)
    return {
      item_type: item.item_type,
      sku_id: item.sku_id || null,
      accessory_id: item.accessory_id || null,
      description: item.description,
      hsn_code: item.hsn_code || null,
      quantity,
      rate,
      gst_rate: entity.is_gst_registered ? Number(item.gst_rate) || 0 : 0,
      gst_type: gst.gstType,
      cgst_amount: gst.cgstAmount,
      sgst_amount: gst.sgstAmount,
      igst_amount: gst.igstAmount,
      amount: gst.amount,
      _lineAmount: lineAmount,
      _gstAmount: gst.gstAmount,
    }
  })

  const subtotal = computedItems.reduce((sum, i) => sum + i._lineAmount, 0)
  const totalGst = computedItems.reduce((sum, i) => sum + i._gstAmount, 0)
  const grandTotal = subtotal + totalGst

  let documentNumber: string
  try {
    documentNumber = await mintSalesDocumentNumber(entity_key, doc_type)
  } catch (err: any) {
    return NextResponse.json({ error: `Failed to generate document number: ${err.message}` }, { status: 500 })
  }

  const { data: document, error: docErr } = await supabaseAdmin
    .from('sales_documents')
    .insert({
      doc_type,
      document_number: documentNumber,
      valid_until: valid_until || null,
      entity_key,
      customer_id,
      customer_name: customer.customer_name,
      customer_gst: customer.gst_number || null,
      customer_address: customer.address || null,
      customer_phone: customer.phone || null,
      customer_email: customer.email || null,
      place_of_supply: placeOfSupplyStateCode,
      subtotal,
      total_gst: totalGst,
      grand_total: grandTotal,
      notes: notes || null,
      terms_conditions: terms_conditions || null,
      created_by: sessionUser.id,
    })
    .select()
    .single()

  if (docErr) return NextResponse.json({ error: docErr.message }, { status: 500 })

  const itemRows = computedItems.map(({ _lineAmount, _gstAmount, ...row }) => ({ ...row, sales_document_id: document.id }))
  const { error: itemsErr } = await supabaseAdmin.from('sales_document_items').insert(itemRows)
  if (itemsErr) {
    // Roll back the document itself if its lines couldn't be written, so we
    // never leave a numbered document with zero items behind.
    await supabaseAdmin.from('sales_documents').delete().eq('id', document.id)
    return NextResponse.json({ error: itemsErr.message }, { status: 500 })
  }

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'create',
    module: 'sales_documents',
    tableName: 'sales_documents',
    recordId: document.id,
    recordLabel: document.document_number,
    metadata: { doc_type, entity_key },
  })

  return NextResponse.json(document, { status: 201 })
}
