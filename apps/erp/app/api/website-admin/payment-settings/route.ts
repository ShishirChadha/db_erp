import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'

// A single row (seeded by migration), never a per-row CRUD list like
// cross-sell-rules/promotions -- GET returns it, PATCH updates it in place.
// Governs apps/web's checkout pricing: the prepaid-discount model (owner's
// decision, 2026-10-06) rather than a surcharge, because a UPI surcharge is
// specifically prohibited in India (Payment & Settlement Systems Act s.10A)
// and card surcharging breaches network rules -- a discount for paying in
// full up front is legal on every method and has the identical economics.
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { data, error } = await supabaseAdmin.from('website_payment_settings').select('*').maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function PATCH(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json() as Record<string, any>
  const { upi_discount_pct, card_discount_pct, cod_handling_fee_pct, cod_token_amount, cod_enabled } = body

  const update: Record<string, unknown> = {}
  for (const [key, val] of Object.entries({ upi_discount_pct, card_discount_pct, cod_handling_fee_pct, cod_token_amount })) {
    if (val === undefined) continue
    const n = Number(val)
    if (!Number.isFinite(n) || n < 0) {
      return NextResponse.json({ error: `${key} must be a non-negative number` }, { status: 400 })
    }
    if (key.endsWith('_pct') && n > 100) {
      return NextResponse.json({ error: `${key} cannot exceed 100` }, { status: 400 })
    }
    update[key] = n
  }
  if (cod_enabled !== undefined) update.cod_enabled = !!cod_enabled
  update.updated_at = new Date().toISOString()

  const { data: existing, error: fetchErr } = await supabaseAdmin
    .from('website_payment_settings')
    .select('id')
    .maybeSingle()
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 })
  if (!existing) return NextResponse.json({ error: 'Settings row missing -- contact support' }, { status: 500 })

  const { error } = await supabaseAdmin.from('website_payment_settings').update(update).eq('id', existing.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAuditEvent({
    actor: { id: sessionUser!.id, email: sessionUser!.email, role: sessionUser!.role },
    actionType: 'update',
    module: 'settings',
    tableName: 'website_payment_settings',
    recordId: existing.id,
    metadata: update,
  })

  return NextResponse.json({ success: true })
}
