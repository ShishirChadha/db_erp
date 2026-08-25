import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'

// ---------- GET: current attachment keys for one invoice ----------
// Same owner-only gate as recording/creating an invoice in the first place
// (POST /api/sales/record-external-invoice) -- this is the same kind of
// invoice bookkeeping action, just after the fact.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const { data, error } = await supabaseAdmin
    .from('invoices')
    .select('id, invoice_number, attachment_urls')
    .eq('id', id)
    .single()
  if (error || !data) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })

  return NextResponse.json({ attachment_urls: data.attachment_urls || [] })
}

// ---------- POST: attach one or more files to an already-created invoice ----------
// Covers the gap left when a Zoho invoice number was recorded (record-external-invoice)
// without its PDF at the time -- attachment_urls is otherwise write-once, set only at
// invoice-creation time in lib/invoice-finalize.ts's createInvoiceFromSales. This route
// is the only way to add to it afterward. Appends (dedupes) rather than replacing, so
// re-uploading later never silently drops a file someone already attached.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const newUrls: string[] = Array.isArray(body.attachment_urls) ? body.attachment_urls.filter(Boolean) : []
  if (newUrls.length === 0) {
    return NextResponse.json({ error: 'Provide at least one attachment_url.' }, { status: 400 })
  }

  const { data: existing, error: fetchErr } = await supabaseAdmin
    .from('invoices')
    .select('id, invoice_number, attachment_urls')
    .eq('id', id)
    .single()
  if (fetchErr || !existing) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })

  const merged = [...new Set([...(existing.attachment_urls || []), ...newUrls])]

  const { error: updateErr } = await supabaseAdmin
    .from('invoices')
    .update({ attachment_urls: merged })
    .eq('id', id)
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'update',
    module: 'sales',
    tableName: 'invoices',
    recordId: id,
    recordLabel: existing.invoice_number || id,
    metadata: { attached: newUrls },
  })

  return NextResponse.json({ attachment_urls: merged })
}
