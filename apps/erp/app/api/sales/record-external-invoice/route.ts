import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { resolveEntityKey, getInvoicingMode, createInvoiceFromSales } from '@/lib/invoice-finalize'
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

  // Preserve the real Zoho number verbatim -- reject a collision with a clear message
  // rather than a raw unique-constraint error.
  const { data: existing } = await supabaseAdmin
    .from('invoices')
    .select('id')
    .eq('invoice_number', invoiceNumber)
    .maybeSingle()
  if (existing) {
    return NextResponse.json({ error: `Invoice number "${invoiceNumber}" already exists in the system.` }, { status: 409 })
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
