import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'

// ---------- DELETE: remove an orphan (no-PO) asset ----------
// Only safe for units that were never attached to a real Purchase Order and
// haven't been sold -- a PO-linked row should be deleted via the PO itself, and a
// sold unit represents a completed real transaction (deleting it would silently
// orphan the linked sales row).
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params

  const { data: asset } = await supabaseAdmin
    .from('asset_ledger')
    .select('*')
    .eq('id', id)
    .single()

  if (!asset) return NextResponse.json({ error: 'Asset not found' }, { status: 404 })
  if (asset.po_id) {
    return NextResponse.json({ error: 'This asset is linked to a PO -- delete via the PO instead.' }, { status: 400 })
  }
  if (asset.status === 'sold') {
    return NextResponse.json({ error: 'Cannot delete a sold unit.' }, { status: 400 })
  }

  const { error } = await supabaseAdmin.from('asset_ledger').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'hard_delete',
    module: 'stock',
    tableName: 'asset_ledger',
    recordId: id,
    recordLabel: asset.asset_number || asset.serial_number || id,
    snapshot: { kind: 'row', table: 'asset_ledger', row: asset },
    restoreStatus: 'restorable',
  })

  return NextResponse.json({ success: true })
}
