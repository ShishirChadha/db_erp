import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'

const KNOWN_MODULES = ['full', 'sales', 'purchases', 'inventory', 'repairs', 'customers_vendors', 'invoices_quotations']

export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const modules: string[] = Array.isArray(body?.modules) ? body.modules : []
  if (modules.length === 0 || modules.some((m) => !KNOWN_MODULES.includes(m))) {
    return NextResponse.json({ error: 'modules must be a non-empty array of known module keys' }, { status: 400 })
  }

  const { data: snapshotId, error } = await supabaseAdmin.rpc('generate_backup_snapshot', {
    p_modules: modules,
    p_trigger_type: 'manual',
    p_created_by: sessionUser.id,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { data: row } = await supabaseAdmin
    .from('backup_snapshots')
    .select('id, created_at, trigger_type, modules, row_counts, status, error_message, size_bytes')
    .eq('id', snapshotId)
    .single()

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'create',
    module: 'backup',
    tableName: 'backup_snapshots',
    recordId: snapshotId,
    recordLabel: `Manual backup (${modules.join(', ')})`,
  })

  return NextResponse.json(row)
}
