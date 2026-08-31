import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'
import { restoreAssetLedgerHardDelete, restorePurchaseOrderHardDelete, restoreSalePaymentHardDelete, restoreVendorPaymentHardDelete } from '@/lib/audit-log-restore'

// Best-effort recovery of a hard-deleted record from its stored snapshot. This can
// legitimately fail cleanly (a serial/asset number was since reused, a referenced SKU
// was archived, etc.) -- the UI must present this as "Attempt Restore", not "Restore".
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params

  const { data: entry } = await supabaseAdmin.from('audit_log').select('*').eq('id', id).single()
  if (!entry) return NextResponse.json({ error: 'Audit log entry not found' }, { status: 404 })
  if (entry.action_type !== 'hard_delete') {
    return NextResponse.json({ error: 'This entry is not a hard-delete event' }, { status: 400 })
  }
  if (entry.restore_status !== 'restorable') {
    return NextResponse.json({ error: `This entry cannot be restored (status: ${entry.restore_status})` }, { status: 400 })
  }
  if (!entry.snapshot) {
    return NextResponse.json({ error: 'No snapshot was captured for this deletion -- cannot restore' }, { status: 400 })
  }

  let result
  if (entry.table_name === 'asset_ledger') {
    result = await restoreAssetLedgerHardDelete(entry.snapshot)
  } else if (entry.table_name === 'purchase_orders') {
    result = await restorePurchaseOrderHardDelete(entry.snapshot)
  } else if (entry.table_name === 'sale_payments') {
    result = await restoreSalePaymentHardDelete(entry.snapshot)
  } else if (entry.table_name === 'vendor_payments') {
    result = await restoreVendorPaymentHardDelete(entry.snapshot)
  } else {
    return NextResponse.json({ error: `No hard-delete restore handler for table "${entry.table_name}"` }, { status: 400 })
  }

  if (!result.success) {
    await supabaseAdmin.from('audit_log').update({ restore_status: 'restore_failed' }).eq('id', id)
    return NextResponse.json({ error: result.error, failed_step: result.failedStep }, { status: 409 })
  }

  await supabaseAdmin
    .from('audit_log')
    .update({ restore_status: 'restored', restored_at: new Date().toISOString(), restored_by: sessionUser.id })
    .eq('id', id)

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'restore',
    module: entry.module,
    tableName: entry.table_name,
    recordId: entry.record_id,
    recordLabel: entry.record_label,
    reason: `Restored hard-delete (original event ${id})`,
  })

  return NextResponse.json({ success: true })
}
