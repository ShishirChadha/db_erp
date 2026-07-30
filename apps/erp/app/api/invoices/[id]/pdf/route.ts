import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, hasPageAccess } from '@/lib/auth/session'
import { renderInvoicePdf } from '@/lib/documents/renderInvoicePdf'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser(req)
  if (!hasPageAccess(sessionUser, 'invoices')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const { id } = await params
  const rendered = await renderInvoicePdf(id)
  if (!rendered) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })

  return new NextResponse(rendered.buffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${rendered.filename}"`,
    },
  })
}
