import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@db/db/admin'

// Creates the auth user, the linked CRM customer record (so sales.customer_id
// works completely unchanged once an order converts to a real sale), and the
// customer_profiles row -- in that order, cleaning up on partial failure.
// email_confirm: true because no verified sending domain/email provider is
// configured yet (see docs/current-progress.md) -- gating signup on a
// confirmation email nobody would receive would just lock everyone out.
// Revisit once Resend is live: switch to the standard signUp + confirmation
// flow without needing to touch anything else in this route.
export async function POST(req: NextRequest) {
  const { email, password, fullName, phone } = await req.json()

  if (!email || !password || !fullName) {
    return NextResponse.json({ error: 'Email, password and name are required' }, { status: 400 })
  }
  if (password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
  }

  const { data: userData, error: userErr } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  })
  if (userErr) {
    const status = userErr.message.toLowerCase().includes('already') ? 409 : 400
    return NextResponse.json({ error: userErr.message }, { status })
  }
  const userId = userData.user.id

  // The ERP enforces one active customer per phone number (customers_active_phone_unique)
  // -- an existing walk-in/in-store customer signing up on the website with the same phone
  // should link their web account to that existing record (reunite their store + web
  // history) rather than fail because the phone is "already taken".
  let customer: { id: string } | null = null
  let reusedExistingCustomer = false
  const trimmedPhone = (phone || '').trim()
  if (trimmedPhone) {
    const { data: existing } = await supabaseAdmin
      .from('customers')
      .select('id')
      .eq('is_deleted', false)
      .eq('phone', trimmedPhone)
      .maybeSingle()
    customer = existing
    reusedExistingCustomer = !!existing
  }

  if (!customer) {
    const { data: created, error: customerErr } = await supabaseAdmin
      .from('customers')
      .insert({
        customer_name: fullName,
        type: 'Individual',
        phone: phone || null,
        email,
        source: 'Website',
      })
      .select()
      .single()

    if (customerErr) {
      await supabaseAdmin.auth.admin.deleteUser(userId)
      return NextResponse.json({ error: customerErr.message }, { status: 400 })
    }
    customer = created
  }
  if (!customer) {
    await supabaseAdmin.auth.admin.deleteUser(userId)
    return NextResponse.json({ error: 'Failed to create customer record' }, { status: 400 })
  }

  const { error: profileErr } = await supabaseAdmin.from('customer_profiles').insert({
    id: userId,
    customer_id: customer.id,
    full_name: fullName,
    phone: phone || null,
  })

  if (profileErr) {
    // Only clean up the customer row if this request created it -- a reused existing
    // (e.g. in-store) customer must never be deleted just because linking a new web
    // account to it failed.
    if (!reusedExistingCustomer) {
      await supabaseAdmin.from('customers').delete().eq('id', customer.id)
    }
    await supabaseAdmin.auth.admin.deleteUser(userId)
    return NextResponse.json({ error: profileErr.message }, { status: 400 })
  }

  return NextResponse.json({ success: true })
}
