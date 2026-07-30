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

  const { data: customer, error: customerErr } = await supabaseAdmin
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

  const { error: profileErr } = await supabaseAdmin.from('customer_profiles').insert({
    id: userId,
    customer_id: customer.id,
    full_name: fullName,
    phone: phone || null,
  })

  if (profileErr) {
    await supabaseAdmin.from('customers').delete().eq('id', customer.id)
    await supabaseAdmin.auth.admin.deleteUser(userId)
    return NextResponse.json({ error: profileErr.message }, { status: 400 })
  }

  return NextResponse.json({ success: true })
}
