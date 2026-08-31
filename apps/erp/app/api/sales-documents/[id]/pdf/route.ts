import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, hasPageAccess } from '@/lib/auth/session'
import { renderSalesDocumentPdf } from '@/lib/documents/renderSalesDocumentPdf'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser(req)
  if (!hasPageAccess(sessionUser, 'quotations')) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const rendered = await renderSalesDocumentPdf(id)
  if (!rendered) return NextResponse.json({ error: 'Document not found' }, { status: 404 })

  return new NextResponse(rendered.buffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${rendered.filename}"`,
    },
  })
}
