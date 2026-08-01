import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'
import { restoreSoftDelete } from '@/lib/audit-log-restore'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params

  const { data: entry } = await supabaseAdmin.from('audit_log').select('*').eq('id', id).single()
  if (!entry) return NextResponse.json({ error: 'Audit log entry not found' }, { status: 404 })
  if (entry.action_type !== 'soft_delete') {
    return NextResponse.json({ error: 'This entry is not a soft-delete event' }, { status: 400 })
  }
  if (entry.restore_status !== 'restorable') {
    return NextResponse.json({ error: `This entry cannot be restored (status: ${entry.restore_status})` }, { status: 400 })
  }
  if (!entry.table_name || !entry.record_id) {
    return NextResponse.json({ error: 'Entry is missing table_name/record_id' }, { status: 400 })
  }

  const { error } = await restoreSoftDelete(entry.table_name, entry.record_id)
  if (error) return NextResponse.json({ error }, { status: 400 })

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
    reason: `Restored soft-delete (original event ${id})`,
  })

  return NextResponse.json({ success: true })
}
