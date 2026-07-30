import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { invalidateRedactionRulesCache } from '@/lib/auth/redact'

// Owner-only, both directions: managers see the effect of this policy (costs shown or
// hidden per redact.ts), but never the policy surface itself -- see docs/decisions.md
// for the confirmed decision behind this.

// ---------- GET: list all redaction rules, grouped by shape client-side ----------
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { data, error } = await supabaseAdmin
    .from('redaction_rules')
    .select('id, shape, field_name, hidden_from_employee, hidden_from_manager')
    .order('shape')
    .order('field_name')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data)
}

// ---------- PATCH: update hidden_from_employee/hidden_from_manager for one {shape, field_name} rule ----------
export async function PATCH(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json()
  const { id, hidden_from_employee, hidden_from_manager } = body as {
    id?: string
    hidden_from_employee?: boolean
    hidden_from_manager?: boolean
  }
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const updates: Record<string, unknown> = {}
  if (hidden_from_employee !== undefined) updates.hidden_from_employee = !!hidden_from_employee
  if (hidden_from_manager !== undefined) updates.hidden_from_manager = !!hidden_from_manager
  if (Object.keys(updates).length === 0) return NextResponse.json({ error: 'No valid fields to update.' }, { status: 400 })

  const { error } = await supabaseAdmin.from('redaction_rules').update(updates).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  invalidateRedactionRulesCache()
  return NextResponse.json({ success: true })
}
