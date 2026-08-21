import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'

const KNOWN_TABLES = [
  'sales', 'sale_payments', 'purchase_orders', 'purchase_order_items', 'purchases',
  'sku_master', 'asset_ledger', 'stock_movements', 'repair_jobs', 'customers', 'vendors',
  'invoices', 'invoice_items', 'sales_documents', 'sales_document_items',
]

export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const payload = body?.payload
  const selected = body?.selected
  if (!payload || typeof payload !== 'object') return NextResponse.json({ error: 'payload is required' }, { status: 400 })
  if (!selected || typeof selected !== 'object') return NextResponse.json({ error: 'selected is required' }, { status: 400 })

  // Reject a tampered request -- every selected id must actually exist in the uploaded payload.
  for (const table of Object.keys(selected)) {
    if (!KNOWN_TABLES.includes(table)) return NextResponse.json({ error: `Unknown table: ${table}` }, { status: 400 })
    const ids: string[] = Array.isArray(selected[table]) ? selected[table] : []
    const payloadIds = new Set((Array.isArray(payload[table]) ? payload[table] : []).map((r: any) => r.id))
    for (const id of ids) {
      if (!payloadIds.has(id)) return NextResponse.json({ error: `Selected id ${id} not present in payload for ${table}` }, { status: 400 })
    }
  }

  const { data: summary, error } = await supabaseAdmin.rpc('apply_backup_restore', {
    p_payload: payload,
    p_selected: selected,
    p_created_by: sessionUser.id,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // logAuditEvent is best-effort and never throws (mirrors lib/notifications.ts's posture) --
  // the restore has already committed safely with its own pre-restore-safety snapshot by this point.
  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'restore',
    module: 'backup',
    tableName: null,
    recordId: summary?.safetySnapshotId ?? null,
    recordLabel: `Backup restore (${Object.keys(selected).join(', ')})`,
    metadata: summary,
  })

  return NextResponse.json(summary)
}
