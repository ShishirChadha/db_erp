import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'

// ---------- POST: record why a RAM/SSD stock follow-up was skipped ----------
// Reassigning a unit to a SKU with more RAM/SSD (FixSkuDialog) prompts a follow-up to
// deduct the matching accessory SKU's stock -- this is what a reasoned skip of that
// prompt calls instead, so the decision leaves an explicit, findable trace (Audit
// Log) rather than silently letting the unit's spec and the accessory's stock count
// drift apart with no record of why. Same minimal auth as reassign-sku itself
// (any signed-in user -- this is reachable from both the owner's Stock "Fix SKU" and
// the Sell form's "Change SKU", open to any role).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json()
  const { field, from, to, reason } = body as { field?: string; from?: string; to?: string; reason?: string }

  if (!field || typeof reason !== 'string' || !reason.trim()) {
    return NextResponse.json({ error: 'field and a non-empty reason are required.' }, { status: 400 })
  }

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'update',
    module: 'sku_master',
    tableName: 'asset_ledger',
    recordId: id,
    metadata: { field, from: from || null, to: to || null, reason: reason.trim() },
    reason: `Component stock follow-up skipped: ${reason.trim()}`,
  })

  return NextResponse.json({ success: true })
}
