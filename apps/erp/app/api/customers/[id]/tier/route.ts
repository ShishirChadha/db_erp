import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'

const ALLOWED_TIERS = ['standard', 'vip', 'wholesale'] as const

// Owner-only: sets the website customer tier (standard/vip/wholesale) for the
// customer_profiles row linked to this CRM customer. Uses supabaseAdmin (service role),
// which bypasses RLS -- the customer_profiles_tier_guard trigger only blocks
// browser-originated (auth.uid()-present) tier changes, not service-role writes.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id: customerId } = await params
  const body = await req.json()
  const { tier } = body as { tier?: string }

  if (!tier || !ALLOWED_TIERS.includes(tier as any)) {
    return NextResponse.json({ error: `tier must be one of: ${ALLOWED_TIERS.join(', ')}` }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('customer_profiles')
    .update({ tier })
    .eq('customer_id', customerId)
    .select('id, customer_id, tier')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'No website account linked to this customer.' }, { status: 404 })

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'update',
    module: 'customers',
    tableName: 'customers',
    recordId: customerId,
    recordLabel: customerId,
    metadata: { tier },
  })

  return NextResponse.json(data)
}
