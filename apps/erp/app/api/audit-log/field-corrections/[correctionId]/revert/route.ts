import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'
import { NON_SCALAR_REVERT_BLOCKLIST } from '@/lib/audit-log-restore'

// old_value/new_value are stored as stringified text -- safe to write back for
// scalar columns, but writing a stringified jsonb/array value back verbatim would
// corrupt the column, so known non-scalar fields are refused rather than guessed at.
export async function POST(req: NextRequest, { params }: { params: Promise<{ correctionId: string }> }) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { correctionId } = await params

  const { data: correction } = await supabaseAdmin
    .from('field_corrections')
    .select('*')
    .eq('id', correctionId)
    .single()
  if (!correction) return NextResponse.json({ error: 'Field correction not found' }, { status: 404 })

  if (NON_SCALAR_REVERT_BLOCKLIST.has(correction.field_name)) {
    return NextResponse.json(
      { error: `"${correction.field_name}" can't be safely auto-reverted -- edit it manually.` },
      { status: 400 }
    )
  }

  const { error } = await supabaseAdmin
    .from(correction.table_name)
    .update({ [correction.field_name]: correction.old_value })
    .eq('id', correction.record_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'restore',
    module: correction.table_name,
    tableName: correction.table_name,
    recordId: correction.record_id,
    fieldCorrectionIds: [correctionId],
    reason: `Reverted field "${correction.field_name}" to its prior value`,
  })

  return NextResponse.json({ success: true })
}
