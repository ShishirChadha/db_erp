import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, hasPageAccess, isManagerOrAbove } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'
import { getLeadSetOrNull, isCurrentHolderOrManager, findDuplicatePhones } from '@/lib/leads'

async function loadLeadWithSet(id: string) {
  const { data: lead } = await supabaseAdmin
    .from('leads').select('id, set_id, name, phone').eq('id', id).eq('is_deleted', false).maybeSingle()
  if (!lead) return null
  const set = await getLeadSetOrNull(lead.set_id)
  if (!set) return null
  return { lead, set }
}

// ---------- PATCH: edit contact fields / status ----------
// Gated on view access + being the Set's current holder (or manager/owner),
// not the separate edit grant -- holding a Set is what grants edit/add
// rights on it now, matching POST /api/leads (add) and the owner's own
// framing ("that user can edit/add but no delete"). Delete stays locked to
// manager/owner regardless (see DELETE below).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPageAccess(sessionUser, 'leads')) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const found = await loadLeadWithSet(id)
  if (!found) return NextResponse.json({ error: 'Lead not found.' }, { status: 404 })
  if (!isCurrentHolderOrManager(sessionUser, found.set)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid body.' }, { status: 400 })

  const updates: Record<string, any> = { updated_at: new Date().toISOString() }
  let duplicateWarning: any = null
  for (const key of ['name', 'phone', 'email', 'address', 'external_identifier', 'status'] as const) {
    if (body[key] === undefined) continue
    if (key === 'name' && !String(body.name).trim()) return NextResponse.json({ error: 'Name cannot be empty.' }, { status: 400 })
    updates[key] = body[key] ? String(body[key]).trim() : null
  }
  if (updates.phone) {
    const dupes = await findDuplicatePhones([updates.phone])
    const hits = (dupes.get(updates.phone) || []).filter((h) => h.lead_id !== id)
    if (hits.length > 0) duplicateWarning = { phone: updates.phone, existing_in: hits }
  }

  const { error } = await supabaseAdmin.from('leads').update(updates).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'update', module: 'leads', tableName: 'leads', recordId: id, recordLabel: found.lead.name,
  })

  return NextResponse.json({ success: true, duplicate_warning: duplicateWarning })
}

// ---------- DELETE: soft-delete one bad row ----------
// Manager/owner only, full stop -- not "current holder", not the edit grant.
// The owner's own framing for a working-copy holder is "edit/add, but no
// delete", so holding a Set (which is now enough for PATCH above) must never
// be enough here.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isManagerOrAbove(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const found = await loadLeadWithSet(id)
  if (!found) return NextResponse.json({ error: 'Lead not found.' }, { status: 404 })

  const { error } = await supabaseAdmin.from('leads').update({ is_deleted: true, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'soft_delete', module: 'leads', tableName: 'leads', recordId: id, recordLabel: found.lead.name,
  })

  return NextResponse.json({ success: true })
}
