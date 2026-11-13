import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, canEditPage } from '@/lib/auth/session'
import { getSalesDocumentDefaults } from '@/lib/sales-documents'

// ---------- GET: entry-form defaults for one entity + doc type ----------
// Read-only -- see getSalesDocumentDefaults() for why the number is a peek, not a
// reservation. Gated on the same edit grant as creating a document, since only
// the entry form uses it (business_profiles itself stays owner-only).
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!canEditPage(sessionUser, 'quotations')) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const docType = searchParams.get('doc_type')
  const entityKey = searchParams.get('entity_key') || ''
  if (docType !== 'quotation' && docType !== 'proforma') {
    return NextResponse.json({ error: "doc_type must be 'quotation' or 'proforma'" }, { status: 400 })
  }

  const defaults = await getSalesDocumentDefaults(entityKey, docType, searchParams.get('customer_id'))
  if (!defaults) return NextResponse.json({ error: `No business profile configured for entity '${entityKey}'` }, { status: 400 })
  return NextResponse.json(defaults)
}
