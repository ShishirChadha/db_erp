import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, canEditPage } from '@/lib/auth/session'
import { checkDuplicateCustomer } from '@/lib/customer-dedupe'
import { logAuditEvent } from '@/lib/audit-log'
import { getLeadSetOrNull, isCurrentHolderOrManager } from '@/lib/leads'

// ---------- POST: convert a lead into a real customers row ----------
// Reuses the exact same dedupe rule the Customers page itself uses
// (lib/customer-dedupe.ts) -- block on phone match, warn on name match --
// so a lead that's secretly already a customer doesn't create a duplicate.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canEditPage(sessionUser, 'leads')) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { data: lead } = await supabaseAdmin
    .from('leads').select('id, set_id, name, phone, email, address, converted_customer_id')
    .eq('id', id).eq('is_deleted', false).maybeSingle()
  if (!lead) return NextResponse.json({ error: 'Lead not found.' }, { status: 404 })
  if (lead.converted_customer_id) return NextResponse.json({ error: 'This lead has already been converted.' }, { status: 400 })

  const set = await getLeadSetOrNull(lead.set_id)
  if (!set) return NextResponse.json({ error: 'Set not found.' }, { status: 404 })
  if (!isCurrentHolderOrManager(sessionUser, set)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { blockingMatch, nameWarningMatch } = await checkDuplicateCustomer(supabaseAdmin as any, {
    customer_name: lead.name, phone: lead.phone || '',
  })

  const body = await req.json().catch(() => ({}))
  if (blockingMatch) {
    // Link to the existing customer rather than failing outright -- the phone
    // already belongs to a real customer record, which is exactly the record
    // this lead should point at.
    const { error: linkErr } = await supabaseAdmin
      .from('leads')
      .update({ converted_customer_id: blockingMatch.id, converted_at: new Date().toISOString(), status: 'Converted', updated_at: new Date().toISOString() })
      .eq('id', id)
    if (linkErr) return NextResponse.json({ error: linkErr.message }, { status: 500 })
    return NextResponse.json({ success: true, customer_id: blockingMatch.id, linked_existing: true })
  }

  if (nameWarningMatch && !body?.confirm_despite_name_warning) {
    return NextResponse.json({
      error: 'A customer with this name already exists under a different phone number.',
      name_warning: nameWarningMatch,
    }, { status: 409 })
  }

  const { data: customer, error: custErr } = await supabaseAdmin
    .from('customers')
    .insert({ customer_name: lead.name, phone: lead.phone || null, email: lead.email || null, address: lead.address || null })
    .select('id').single()
  if (custErr || !customer) return NextResponse.json({ error: custErr?.message || 'Failed to create customer.' }, { status: 500 })

  const { error: updateErr } = await supabaseAdmin
    .from('leads')
    .update({ converted_customer_id: customer.id, converted_at: new Date().toISOString(), status: 'Converted', updated_at: new Date().toISOString() })
    .eq('id', id)
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'create', module: 'leads', tableName: 'customers', recordId: customer.id, recordLabel: lead.name,
    metadata: { converted_from_lead_id: id },
  })

  return NextResponse.json({ success: true, customer_id: customer.id, linked_existing: false }, { status: 201 })
}
