import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'

// Soft-retire only -- see backups/20261005_business_updates.sql for why this
// is is_active=false rather than a delete.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser || !isOwner(sessionUser)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }
  const { id } = await params

  const { error } = await supabaseAdmin
    .from('business_updates')
    .update({ is_active: false })
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'soft_delete',
    module: 'business_updates',
    tableName: 'business_updates',
    recordId: id,
    recordLabel: `Business update retired`,
  })

  return NextResponse.json({ success: true })
}
