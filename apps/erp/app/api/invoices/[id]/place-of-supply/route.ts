import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'
import { applyPlaceOfSupply } from '@/lib/gst-place-of-supply'

// Owner-only: correct an issued invoice's place of supply (tax head re-split, totals
// unchanged). The full Edit screen stays draft-only.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const pos = String(body.place_of_supply ?? '').trim()
  const result = await applyPlaceOfSupply(id, pos)
  if (!result.ok) return NextResponse.json({ error: result.message }, { status: result.status })

  await logAuditEvent({
    actor: { id: sessionUser!.id, email: sessionUser!.email, role: sessionUser!.role },
    actionType: 'update', module: 'invoices', tableName: 'invoices',
    recordId: id, recordLabel: 'place of supply',
    metadata: { from: result.from, to: pos },
  })
  return NextResponse.json({ ok: true })
}
