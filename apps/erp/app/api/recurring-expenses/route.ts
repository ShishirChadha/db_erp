import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'

const INTERVAL_UNITS = ['weekly', 'monthly', 'yearly']

// Owner-only, matching the "manage dropdown-option lists"/vendor-management
// posture for this kind of scheduled-financial-obligation config -- distinct from
// the expenses themselves, which any role with the 'expenses' edit grant can log.
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { data, error } = await supabaseAdmin
    .from('recurring_expense_rules')
    .select('*, vendors(company_name)')
    .order('next_due_date')

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data || [])
}

export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json()
  const {
    type, description, payment_account, vendor_id, expected_amount,
    interval_unit, next_due_date, reminder_lead_days, assignee_id,
  } = body

  if (!type || !payment_account || !interval_unit || !next_due_date) {
    return NextResponse.json({ error: 'type, payment_account, interval_unit, and next_due_date are required.' }, { status: 400 })
  }
  if (!INTERVAL_UNITS.includes(interval_unit)) {
    return NextResponse.json({ error: `interval_unit must be one of: ${INTERVAL_UNITS.join(', ')}` }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('recurring_expense_rules')
    .insert({
      type,
      description: description || null,
      payment_account,
      entity_key: String(payment_account).toLowerCase(),
      vendor_id: vendor_id || null,
      expected_amount: expected_amount != null ? Number(expected_amount) : null,
      interval_unit,
      next_due_date,
      reminder_lead_days: reminder_lead_days != null ? Number(reminder_lead_days) : 3,
      assignee_id: assignee_id || null,
      created_by: sessionUser!.id,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  await logAuditEvent({
    actor: { id: sessionUser!.id, email: sessionUser!.email, role: sessionUser!.role },
    actionType: 'create',
    module: 'expenses',
    tableName: 'recurring_expense_rules',
    recordId: data.id,
    recordLabel: `Recurring: ${data.type} (${data.interval_unit})`,
  })

  return NextResponse.json(data, { status: 201 })
}
