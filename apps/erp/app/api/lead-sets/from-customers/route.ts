import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isManagerOrAbove } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'
import { notify } from '@/lib/notifications'
import { DEFAULT_LEAD_STATUS } from '@/lib/leads'

// ---------- POST: snapshot existing customers into a new Set (e.g. win-back calling) ----------
// Copies contact fields only -- never sales/financial history -- and never sets
// converted_customer_id (these leads aren't conversions, customers is the
// source, not the destination, here).
export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isManagerOrAbove(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid body.' }, { status: 400 })
  const { name, description, assignee_id, customer_ids } = body

  if (!name || !String(name).trim()) return NextResponse.json({ error: 'Set name is required.' }, { status: 400 })
  if (!assignee_id) return NextResponse.json({ error: 'assignee_id is required.' }, { status: 400 })
  if (!Array.isArray(customer_ids) || customer_ids.length === 0) {
    return NextResponse.json({ error: 'At least one customer must be selected.' }, { status: 400 })
  }

  const { data: assignee } = await supabaseAdmin
    .from('profiles').select('id, is_active').eq('id', assignee_id).maybeSingle()
  if (!assignee || !assignee.is_active) {
    return NextResponse.json({ error: 'The chosen staff member is not a valid active user.' }, { status: 400 })
  }

  const { data: customers, error: custErr } = await supabaseAdmin
    .from('customers').select('customer_name, phone, email, address')
    .in('id', customer_ids).eq('is_deleted', false)
  if (custErr) return NextResponse.json({ error: custErr.message }, { status: 500 })
  if (!customers || customers.length === 0) return NextResponse.json({ error: 'No matching customers found.' }, { status: 400 })

  const { data: set, error: setErr } = await supabaseAdmin
    .from('lead_sets')
    .insert({
      name: String(name).trim(),
      description: description ? String(description).trim() : null,
      source_type: 'customers_snapshot',
      current_assignee_id: assignee_id,
      created_by: sessionUser.id,
    })
    .select('id, name')
    .single()
  if (setErr || !set) return NextResponse.json({ error: setErr?.message || 'Failed to create set.' }, { status: 500 })

  const { error: leadsErr } = await supabaseAdmin.from('leads').insert(
    customers.map((c: any) => ({
      set_id: set.id, name: c.customer_name, phone: c.phone, email: c.email, address: c.address,
      status: DEFAULT_LEAD_STATUS, created_by: sessionUser.id,
    }))
  )
  if (leadsErr) {
    await supabaseAdmin.from('lead_sets').delete().eq('id', set.id)
    return NextResponse.json({ error: leadsErr.message }, { status: 500 })
  }

  await supabaseAdmin.from('lead_set_assignment_history').insert({
    set_id: set.id, assignee_id, assigned_by: sessionUser.id,
  })

  await notify({
    recipientId: assignee_id, type: 'task_assigned', actorId: sessionUser.id,
    title: `New Lead Set "${set.name}" assigned to you`, link: `/dashboard/leads?set=${set.id}`,
  })

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'create', module: 'leads', tableName: 'lead_sets', recordId: set.id, recordLabel: set.name,
    metadata: { action: 'from_customers', customer_count: customers.length, assignee_id },
  })

  return NextResponse.json({ success: true, id: set.id, name: set.name, row_count: customers.length }, { status: 201 })
}
