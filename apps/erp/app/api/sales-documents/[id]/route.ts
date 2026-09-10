import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, hasPageAccess, canEditPage } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'
import { computeLineGst } from '@/lib/sales-documents'

const VALID_STATUSES = ['draft', 'sent', 'accepted', 'rejected', 'expired', 'void']

// ---------- GET: one quotation/proforma with its line items ----------
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser(req)
  if (!hasPageAccess(sessionUser, 'quotations')) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const { data: document, error } = await supabaseAdmin.from('sales_documents').select('*').eq('id', id).single()
  if (error || !document) return NextResponse.json({ error: 'Document not found' }, { status: 404 })

  const { data: items } = await supabaseAdmin
    .from('sales_document_items')
    .select('*')
    .eq('sales_document_id', id)
    .order('created_at', { ascending: true })

  return NextResponse.json({ ...document, items: items || [] })
}

// ---------- PATCH: update status/notes/terms/validity, or (while still pending) customer + line items ----------
// customer_id/items may only be edited while the document is still 'draft' or 'sent'
// AND none of its lines have been converted into a real sale yet -- a converted line
// already produced a real sales row from that line's numbers, so rewriting the line
// afterward would silently desync the document from what was actually sold. Once
// either condition no longer holds, void this one and create a fresh document instead,
// so the original is preserved for audit exactly as it was actually sent.
// Edit access follows the same per-page grant every other module uses (canEditPage) --
// not owner-only, so any role the owner has granted 'quotations' edit access can fix a
// forgotten customer/line before it's sent out or converted.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canEditPage(sessionUser, 'quotations')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json()
  const { status, notes, terms_conditions, valid_until, customer_id, entity_key, items } = body

  const { data: existing, error: existingErr } = await supabaseAdmin
    .from('sales_documents')
    .select('*, sales_document_items(*)')
    .eq('id', id)
    .single()
  if (existingErr || !existing) return NextResponse.json({ error: 'Document not found' }, { status: 404 })

  const updates: Record<string, any> = { updated_at: new Date().toISOString() }
  if (status !== undefined) {
    if (!VALID_STATUSES.includes(status)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    updates.status = status
  }
  if (notes !== undefined) updates.notes = notes
  if (terms_conditions !== undefined) updates.terms_conditions = terms_conditions
  if (valid_until !== undefined) updates.valid_until = valid_until

  const editingContent = customer_id !== undefined || entity_key !== undefined || items !== undefined
  if (editingContent) {
    const hasConvertedItem = (existing.sales_document_items || []).some((i: any) => i.converted)
    if (existing.status === 'void' || hasConvertedItem || !['draft', 'sent'].includes(existing.status)) {
      return NextResponse.json({
        error: hasConvertedItem
          ? 'One or more lines on this document have already been converted into a sale -- void this document and create a fresh one instead of editing customer/entity/line items now.'
          : `Customer/entity/line items can only be edited while a document is 'draft' or 'sent' (current status: ${existing.status}).`,
      }, { status: 409 })
    }

    const resolvedEntityKey = entity_key !== undefined ? entity_key : existing.entity_key
    const { data: entity } = await supabaseAdmin
      .from('business_profiles')
      .select('is_gst_registered, state_code')
      .eq('key', resolvedEntityKey)
      .single()
    if (!entity) return NextResponse.json({ error: `No business profile configured for entity '${resolvedEntityKey}'` }, { status: 400 })
    if (entity_key !== undefined) updates.entity_key = resolvedEntityKey

    let customerRow = null as any
    const resolvedCustomerId = customer_id !== undefined ? customer_id : existing.customer_id
    if (!resolvedCustomerId) return NextResponse.json({ error: 'customer_id is required' }, { status: 400 })
    const { data: customer } = await supabaseAdmin
      .from('customers')
      .select('customer_name, gst_number, address, phone, email, state_code')
      .eq('id', resolvedCustomerId)
      .single()
    if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
    customerRow = customer

    const placeOfSupplyStateCode = customer.gst_number?.trim().slice(0, 2) || customer.state_code || entity.state_code || null

    updates.customer_id = resolvedCustomerId
    updates.customer_name = customerRow.customer_name
    updates.customer_gst = customerRow.gst_number || null
    updates.customer_address = customerRow.address || null
    updates.customer_phone = customerRow.phone || null
    updates.customer_email = customerRow.email || null
    updates.place_of_supply = placeOfSupplyStateCode

    // Line items are only ever replaced wholesale (delete + reinsert), never patched
    // in place -- with none converted yet (checked above) there's no sale_id/converted
    // state on any row that would need preserving across the replace. Also re-derived
    // (from the existing rows) whenever entity_key changes without new items being
    // passed -- GST type/amounts depend on the entity, so leaving them as before would
    // silently mismatch the newly selected entity.
    if (items !== undefined || entity_key !== undefined) {
      const sourceItems = items !== undefined ? items : existing.sales_document_items
      if (!Array.isArray(sourceItems) || sourceItems.length === 0) {
        return NextResponse.json({ error: 'At least one line item is required' }, { status: 400 })
      }
      const computedItems = sourceItems.map((item: any) => {
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
      updates.subtotal = subtotal
      updates.total_gst = totalGst
      updates.grand_total = subtotal + totalGst

      const { error: deleteErr } = await supabaseAdmin.from('sales_document_items').delete().eq('sales_document_id', id)
      if (deleteErr) return NextResponse.json({ error: deleteErr.message }, { status: 500 })
      const itemRows = computedItems.map(({ _lineAmount, _gstAmount, ...row }) => ({ ...row, sales_document_id: id }))
      const { error: insertErr } = await supabaseAdmin.from('sales_document_items').insert(itemRows)
      if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 })
    }
  }

  const { data, error } = await supabaseAdmin
    .from('sales_documents')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  // status -> 'void' is a distinct, higher-severity action from a plain field
  // edit or any other status transition; audit-log.ts already models both.
  const actionType = status === 'void' ? 'void' : status !== undefined ? 'status_change' : 'update'
  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType,
    module: 'sales_documents',
    tableName: 'sales_documents',
    recordId: id,
    recordLabel: data.document_number,
    metadata: { updated_fields: Object.keys(updates).filter((k) => k !== 'updated_at') },
  })

  return NextResponse.json(data)
}
