import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'

// Bank accounts carry balance/transaction data -- owner-only, same posture as
// every other reconciliation surface.
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { data, error } = await supabaseAdmin.from('bank_accounts').select('*').eq('is_active', true).order('label')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json()
  const { entity_key, label, bank_name, account_number_last4, opening_balance, opening_balance_date } = body
  if (!entity_key) return NextResponse.json({ error: 'entity_key is required.' }, { status: 400 })
  if (!label?.trim()) return NextResponse.json({ error: 'label is required.' }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('bank_accounts')
    .insert({
      entity_key, label: label.trim(), bank_name: bank_name || null,
      account_number_last4: account_number_last4 || null,
      opening_balance: opening_balance ?? 0, opening_balance_date: opening_balance_date || null,
      created_by: sessionUser.id,
    })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'create', module: 'reconciliation', tableName: 'bank_accounts', recordId: data.id, recordLabel: data.label,
  })

  return NextResponse.json(data, { status: 201 })
}
