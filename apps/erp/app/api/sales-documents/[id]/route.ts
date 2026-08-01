import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'

const VALID_STATUSES = ['draft', 'sent', 'accepted', 'rejected', 'expired', 'void']

// ---------- GET: one quotation/proforma with its line items ----------
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const { data: document, error } = await supabaseAdmin.from('sales_documents').select('*').eq('id', id).single()
  if (error || !document) return NextResponse.json({ error: 'Document not found' }, { status: 404 })

  const { data: items } = await supabaseAdmin
    .from('sales_document_items')
    .select('*')
    .eq('sales_document_id', id)
    .order('created_at', { ascending: true })

  return NextResponse.json({ ...document, items: items || [] })
}

// ---------- PATCH: update status/notes/terms/validity -- never line items ----------
// Line items are fixed at creation; if the offer changes, void this one and
// create a fresh document, so the original is preserved for audit exactly
// as it was actually sent.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const body = await req.json()
  const { status, notes, terms_conditions, valid_until } = body

  const updates: Record<string, any> = { updated_at: new Date().toISOString() }
  if (status !== undefined) {
    if (!VALID_STATUSES.includes(status)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    updates.status = status
  }
  if (notes !== undefined) updates.notes = notes
  if (terms_conditions !== undefined) updates.terms_conditions = terms_conditions
  if (valid_until !== undefined) updates.valid_until = valid_until

  const { data, error } = await supabaseAdmin
    .from('sales_documents')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  // status -> 'void' is a distinct, higher-severity action from a plain field
  // edit or any other status transition; audit-log.ts already models both.
  const actionType = status === 'void' ? 'void' : status !== undefined ? 'status_change' : 'update'
  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType,
    module: 'sales_documents',
    tableName: 'sales_documents',
    recordId: id,
    recordLabel: data.document_number,
    metadata: { updated_fields: Object.keys(updates).filter((k) => k !== 'updated_at') },
  })

  return NextResponse.json(data)
}
