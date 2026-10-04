// Period locks. Owner-only -- this stops other people's work, so it is not a
// grantable permission.
//
// The lock is on TRANSACTION date, not entry date: that is what stops a
// back-dated row landing in a period already filed, which is the entire point.
// Deliberately decoupled from filing status (a filed period only *suggests*
// locking), matching how Zoho keeps transaction locking separate from its
// return workflow.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'

const MODULES = ['sales', 'purchases', 'banking', 'accounts']

export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  const { data, error } = await supabaseAdmin.from('period_locks').select('*').order('module')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const { entity_key, module, locked_through_date, reason } = body
  if (!module || !MODULES.includes(module)) {
    return NextResponse.json({ error: `module must be one of: ${MODULES.join(', ')}` }, { status: 400 })
  }
  if (!locked_through_date) {
    return NextResponse.json({ error: 'locked_through_date is required' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('period_locks')
    .upsert({
      entity_key: entity_key || null,
      module,
      locked_through_date,
      reason: reason || null,
      locked_by: sessionUser!.id,
      locked_at: new Date().toISOString(),
      // Setting a new lock closes any previous carve-out, so an old unlock
      // cannot silently keep a window open.
      unlock_from: null, unlock_to: null, unlock_reason: null,
      unlocked_by: null, unlocked_at: null,
    }, { onConflict: 'entity_key,module' })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAuditEvent({
    actor: { id: sessionUser!.id, email: sessionUser!.email, role: sessionUser!.role },
    actionType: 'update', module: 'gst', tableName: 'period_locks',
    recordId: data.id, recordLabel: `${module} through ${locked_through_date}`,
    metadata: { entity_key: entity_key || null, reason: reason || null },
  })
  return NextResponse.json(data, { status: 201 })
}

// Partial unlock: carve a dated window back out of an existing lock. A reason
// is mandatory (DB-enforced too) because this is the audit trail for reopening
// a closed period.
export async function PATCH(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json().catch(() => null)
  if (!body?.id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const { id, unlock_from, unlock_to, unlock_reason } = body

  // Clearing the window closes the carve-out again.
  if (!unlock_from && !unlock_to) {
    const { data, error } = await supabaseAdmin.from('period_locks')
      .update({ unlock_from: null, unlock_to: null, unlock_reason: null, unlocked_by: null, unlocked_at: null })
      .eq('id', id).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data)
  }

  if (!unlock_from || !unlock_to) {
    return NextResponse.json({ error: 'unlock_from and unlock_to must both be set' }, { status: 400 })
  }
  if (!String(unlock_reason || '').trim()) {
    return NextResponse.json({ error: 'unlock_reason is required when reopening a locked window' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin.from('period_locks')
    .update({
      unlock_from, unlock_to, unlock_reason: String(unlock_reason).trim(),
      unlocked_by: sessionUser!.id, unlocked_at: new Date().toISOString(),
    })
    .eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAuditEvent({
    actor: { id: sessionUser!.id, email: sessionUser!.email, role: sessionUser!.role },
    actionType: 'update', module: 'gst', tableName: 'period_locks',
    recordId: id, recordLabel: `partial unlock ${unlock_from}..${unlock_to}`,
    metadata: { unlock_reason: String(unlock_reason).trim() },
  })
  return NextResponse.json(data)
}
