import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, canEditPage } from '@/lib/auth/session'
import { peekDocumentNumber } from '@/lib/sales-documents'
import { getInvoicingMode } from '@/lib/invoice-finalize'

// ---------- GET: preview of the next sales-invoice number for an entity ----------
// Read-only peek shown on the New Invoice form -- nothing is reserved, so a
// cancelled form burns no number. The real number is minted on save by
// mintInvoiceNumber() (app/actions/invoice.ts).
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!canEditPage(sessionUser, 'invoices')) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const entityKey = new URL(req.url).searchParams.get('entity_key') || ''
  // 'external' = still invoicing in Zoho; the form blocks saving for it, since
  // mintInvoiceNumber() refuses to issue a number for that entity.
  const [nextNumber, invoicingMode] = await Promise.all([peekDocumentNumber(entityKey, 'sales_invoice'), getInvoicingMode(entityKey)])
  return NextResponse.json({ next_number: nextNumber, invoicing_mode: invoicingMode })
}
