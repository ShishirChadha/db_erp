import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@db/db/admin'
import { findSharedDocument } from '@/lib/document-share'

// "View / download PDF": a fresh 10-minute signed URL to the private
// `documents` bucket, so the long-lived thing in the customer's chat is only
// the short code. Opens are counted here (not on the page, which WhatsApp's
// preview fetcher also loads).
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const doc = await findSharedDocument(code)
  if (doc.state !== 'ok') return NextResponse.redirect(new URL(`/d/${encodeURIComponent(code)}`, req.url))

  const { data: signed, error } = await supabaseAdmin.storage.from('documents').createSignedUrl(doc.storagePath, 600)
  if (error || !signed) return new NextResponse('The document could not be opened. Please try again.', { status: 502 })

  await supabaseAdmin.from('document_share_links')
    .update({ open_count: doc.openCount + 1, last_opened_at: new Date().toISOString() })
    .eq('code', doc.code)

  return NextResponse.redirect(signed.signedUrl, { headers: { 'Cache-Control': 'no-store' } })
}
