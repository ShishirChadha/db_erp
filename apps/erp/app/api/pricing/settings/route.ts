import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'
import { loadRules } from '@/lib/pricing-board'

const ROUNDING = ['none', 'ten', 'hundred', '99', '999']

export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  return NextResponse.json(await loadRules())
}

export async function PUT(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  const body = await req.json()

  const patch: Record<string, unknown> = {}
  const num = (k: string, min: number, max: number, label: string) => {
    if (body[k] === undefined) return null
    const n = Number(body[k])
    if (!Number.isFinite(n) || n < min || n > max) return `${label} must be between ${min} and ${max}.`
    patch[k] = n
    return null
  }
  const errors = [
    num('min_margin_pct', 0, 89, 'Minimum margin'),
    num('aging_days', 7, 365, 'Aging days'),
    num('undercut_tolerance', 0, 100000, 'Undercut tolerance'),
    num('beat_by', 0, 100000, 'Beat-by amount'),
    num('aging_drop_pct', 0, 50, 'Aging drop'),
  ].filter(Boolean)
  if (body.rounding !== undefined) {
    if (!ROUNDING.includes(body.rounding)) errors.push('Unknown rounding style.')
    else patch.rounding = body.rounding
  }
  if (errors.length) return NextResponse.json({ error: errors.join(' ') }, { status: 400 })
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

  const before = await loadRules()
  const { error } = await supabaseAdmin.from('pricing_settings').update({ ...patch, updated_by: sessionUser.id, updated_at: new Date().toISOString() }).eq('id', true)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'update', module: 'settings', tableName: 'pricing_settings', recordId: null, recordLabel: 'Pricing rules',
    metadata: { before, changed: patch },
  })
  return NextResponse.json(await loadRules())
}
