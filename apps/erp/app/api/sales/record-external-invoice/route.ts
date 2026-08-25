import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { resolveEntityKey, getInvoicingMode, createInvoiceFromSales, appendSalesToInvoice } from '@/lib/invoice-finalize'
import { logAuditEvent } from '@/lib/audit-log'

// ---------- POST: record a Zoho (external) invoice number against one or more sales ----------
// The transition-mode counterpart to /finalize: while an entity is issuing invoices in
// Zoho, the ERP records the real Zoho number verbatim (source='imported_zoho') and marks
// the sale(s) done, but NEVER calls the numbering RPC -- so the live ERP counter can't
// desync or collide. Accepts sale_ids: string[] (1 = single, 2+ = one combined Zoho
// invoice over several sales), same customer + same entity.
export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const saleIds: string[] = Array.isArray(body.sale_ids) ? body.sale_ids : []
  const invoiceNumber: string = (body.invoice_number || '').trim()
  const invoiceDate = body.invoice_date || new Date().toISOString().slice(0, 10)
  const attachmentUrls: string[] = Array.isArray(body.attachment_urls) ? body.attachment_urls : []

  if (saleIds.length === 0) return NextResponse.json({ error: 'Provide at least one sale_id.' }, { status: 400 })
  if (!invoiceNumber) return NextResponse.json({ error: 'The Zoho invoice number is required.' }, { status: 400 })

  const { data: sales, error: salesErr } = await supabaseAdmin.from('sales').select('*').in('id', saleIds)
  if (salesErr) return NextResponse.json({ error: salesErr.message }, { status: 500 })
  if (!sales || sales.length !== saleIds.length) {
    return NextResponse.json({ error: 'One or more sales were not found.' }, { status: 404 })
  }
  if (sales.some((s) => s.is_deleted)) {
    return NextResponse.json({ error: 'One or more of these sales were voided and cannot be invoiced.' }, { status: 400 })
  }
  if (sales.some((s) => s.finalized)) {
    return NextResponse.json({ error: `${sales.filter((s) => s.finalized).length} of these sales already have an invoice.` }, { status: 400 })
  }
  if (new Set(sales.map((s) => s.customer_id)).size > 1) {
    return NextResponse.json({ error: 'All selected sales must belong to the same customer.' }, { status: 400 })
  }
  const entityKeys = new Set(sales.map((s) => resolveEntityKey(s.payment_account)))
  if (entityKeys.size > 1) {
    return NextResponse.json({ error: 'All selected sales must be paid into the same account.' }, { status: 400 })
  }
  const entityKey = [...entityKeys][0]

  // Recording a Zoho number only makes sense while the entity is in external (Zoho)
  // mode; once it's on ERP generation, use Generate Invoice instead.
  if ((await getInvoicingMode(entityKey)) !== 'external') {
    return NextResponse.json({
      error: `${entityKey} is set to generate invoices in the ERP, not Zoho. Use "Generate Invoice" instead, or switch it to Zoho transition mode in Settings.`,
    }, { status: 409 })
  }

  // Preserve the real Zoho number verbatim. A collision on the number isn't always a
  // mistake -- Zoho commonly issues ONE invoice covering several units/sales that
  // didn't all get selected together in the ERP the first time (e.g. 3 laptops sold
  // the same day, only 1 recorded initially). If the existing invoice is the same
  // Zoho-sourced invoice for the same customer + entity, append these sale(s) to it as
  // extra line items instead of blocking. Anything else (different customer/entity, or
  // an ERP-generated invoice) is a real collision/typo and still hard-blocks.
  const { data: existing } = await supabaseAdmin
    .from('invoices')
    .select('id, entity_key, customer_id, source')
    .eq('invoice_number', invoiceNumber)
    .maybeSingle()

  if (existing) {
    if (existing.source !== 'imported_zoho') {
      return NextResponse.json({
        error: `Invoice number "${invoiceNumber}" already exists as an ERP-generated invoice -- it can't be extended from here.`,
      }, { status: 409 })
    }
    if (existing.entity_key !== entityKey || existing.customer_id !== sales[0].customer_id) {
      return NextResponse.json({
        error: `Invoice number "${invoiceNumber}" already exists for a different customer or entity. Double-check the number, or void the earlier record first if it was entered by mistake.`,
      }, { status: 409 })
    }

    const appendResult = await appendSalesToInvoice({
      invoiceId: existing.id,
      sales,
      entityKey,
      userId: sessionUser.id,
      attachmentUrls,
    })
    if (!appendResult.ok) return NextResponse.json({ error: appendResult.error }, { status: appendResult.status })

    await logAuditEvent({
      actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
      actionType: 'update',
      module: 'sales',
      tableName: 'invoices',
      recordId: appendResult.invoice_id,
      recordLabel: appendResult.invoice_number,
      metadata: { sale_ids: saleIds, appended: true },
    })

    return NextResponse.json({
      success: true,
      invoice_id: appendResult.invoice_id,
      invoice_number: appendResult.invoice_number,
      sale_count: sales.length,
      appended: true,
    })
  }

  const result = await createInvoiceFromSales({
    sales,
    entityKey,
    source: 'imported_zoho',
    invoiceDate,
    userId: sessionUser.id,
    attachmentUrls,
    invoiceNumber, // recorded verbatim -- no minting, counter untouched
  })

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'create',
    module: 'sales',
    tableName: 'invoices',
    recordId: result.invoice_id || null,
    recordLabel: result.invoice_number || invoiceNumber,
    metadata: { sale_ids: saleIds },
  })

  return NextResponse.json({ success: true, invoice_id: result.invoice_id, invoice_number: result.invoice_number, sale_count: sales.length })
}
