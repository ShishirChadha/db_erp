import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { mintSalesInvoiceNumber } from '@/lib/sales-entry'
import { resolveEntityKey, getInvoicingMode, createInvoiceFromSales } from '@/lib/invoice-finalize'
import { logAuditEvent } from '@/lib/audit-log'

// ---------- POST: owner generates the GST invoice for an already-completed sale ----------
// The sale itself already happened (unit/accessory left stock at POST /api/sales-entry
// time) -- this route is invoice-only bookkeeping. It must NOT touch asset_ledger status,
// quantity_in_stock, or accessory stock again, or the sale's original stock movement
// would get double-counted.
// For invoicing several sales together (same customer, same entity) into one
// invoice, see POST /api/sales/finalize-batch instead.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params

  const { data: sale } = await supabaseAdmin.from('sales').select('*').eq('id', id).single()
  if (!sale) return NextResponse.json({ error: 'Sale not found' }, { status: 404 })
  if (sale.finalized) return NextResponse.json({ error: 'This sale already has an invoice.' }, { status: 400 })

  const entityKey = resolveEntityKey(sale.payment_account)

  // Zoho transition: while this entity is in 'external' mode the invoice is still issued
  // in Zoho -- the ERP must not mint its own number. Record the Zoho number instead.
  if ((await getInvoicingMode(entityKey)) === 'external') {
    return NextResponse.json({
      error: `${entityKey} invoices are still generated in Zoho during the transition. Use "Record Zoho Invoice #" instead of generating one here.`,
      error_code: 'external_invoicing',
    }, { status: 409 })
  }

  const body = await req.json().catch(() => ({}))
  const invoiceDate = body.invoice_date || new Date().toISOString().slice(0, 10)

  const result = await createInvoiceFromSales({
    sales: [sale],
    entityKey,
    source: 'system_issued',
    invoiceDate,
    userId: sessionUser.id,
    mintNumber: () => mintSalesInvoiceNumber(entityKey),
  })

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'status_change',
    module: 'sales',
    tableName: 'sales',
    recordId: id,
    recordLabel: result.invoice_number || sale.invoice_number || id,
    reason: 'Sale finalized -- invoice generated',
  })

  return NextResponse.json({ success: true, invoice_id: result.invoice_id, invoice_number: result.invoice_number })
}
