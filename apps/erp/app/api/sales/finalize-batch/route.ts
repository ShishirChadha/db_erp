import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { mintSalesInvoiceNumber } from '@/lib/sales-entry'
import { resolveEntityKey, getInvoicingMode, createInvoiceFromSales } from '@/lib/invoice-finalize'
import { logAuditEvent } from '@/lib/audit-log'

// ---------- POST: owner generates ONE GST invoice covering several sales ----------
// For the same customer paid into the same account (Digitalbluez/Techtenth/Cash),
// combines multiple un-finalized sales into a single multi-item invoice. Sales stay
// the operational source of truth; this route is invoice-only bookkeeping and never
// re-touches inventory, exactly like the single-sale finalize route it's a sibling of.
export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const saleIds: string[] = Array.isArray(body.sale_ids) ? body.sale_ids : []
  const invoiceDate = body.invoice_date || new Date().toISOString().slice(0, 10)

  if (saleIds.length < 2) {
    return NextResponse.json({ error: 'Provide at least 2 sale_ids -- use the single-sale finalize route for one sale.' }, { status: 400 })
  }

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
    return NextResponse.json({ error: 'All selected sales must be paid into the same account (Digitalbluez/Techtenth/Cash).' }, { status: 400 })
  }
  const entityKey = [...entityKeys][0]

  if ((await getInvoicingMode(entityKey)) === 'external') {
    return NextResponse.json({
      error: `${entityKey} invoices are still generated in Zoho during the transition. Use "Record Zoho Invoice #" instead of generating one here.`,
      error_code: 'external_invoicing',
    }, { status: 409 })
  }

  const result = await createInvoiceFromSales({
    sales,
    entityKey,
    source: 'system_issued',
    invoiceDate,
    userId: sessionUser.id,
    mintNumber: () => mintSalesInvoiceNumber(entityKey),
  })

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

  // One summary row covering the whole batch -- every finalized sale's id is still
  // traceable via metadata.sale_ids rather than one row per sale.
  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'status_change',
    module: 'sales',
    tableName: 'sales',
    recordId: null,
    recordLabel: result.invoice_number || `Batch of ${sales.length} sales`,
    metadata: { sale_ids: saleIds, invoice_id: result.invoice_id, invoice_number: result.invoice_number },
    reason: 'Batch sale finalization -- invoice generated',
  })

  return NextResponse.json({ success: true, invoice_id: result.invoice_id, invoice_number: result.invoice_number, sale_count: sales.length })
}
