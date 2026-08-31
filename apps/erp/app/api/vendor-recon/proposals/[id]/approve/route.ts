import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logFieldCorrections } from '@/lib/field-corrections'
import { logAuditEvent } from '@/lib/audit-log'

// ---------- POST: approve one proposal -- writes to vendors, logs a reversible correction ----------
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const { data: proposal, error: propErr } = await supabaseAdmin.from('vendor_correction_proposals').select('*').eq('id', id).single()
  if (propErr || !proposal) return NextResponse.json({ error: 'Proposal not found' }, { status: 404 })
  if (proposal.status !== 'pending') return NextResponse.json({ error: `This proposal is already ${proposal.status}.` }, { status: 409 })

  const fieldValue = proposal.field_name === 'has_gst' ? proposal.proposed_value === 'true' : proposal.proposed_value

  const { error: updateErr } = await supabaseAdmin
    .from('vendors')
    .update({ [proposal.field_name]: fieldValue })
    .eq('id', proposal.vendor_id)
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

  const correctionIds = await logFieldCorrections(
    'vendors',
    proposal.vendor_id,
    [{ field: proposal.field_name, oldValue: proposal.current_value, newValue: proposal.proposed_value }],
    sessionUser.id,
    `Vendor recon from invoice document ${proposal.document_id}`
  )

  const { data: updated, error: statusErr } = await supabaseAdmin
    .from('vendor_correction_proposals')
    .update({ status: 'approved', decided_by: sessionUser.id, decided_at: new Date().toISOString(), field_correction_id: correctionIds[0] || null })
    .eq('id', id)
    .select()
    .single()
  if (statusErr) return NextResponse.json({ error: statusErr.message }, { status: 500 })

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'update',
    module: 'vendors',
    tableName: 'vendors',
    recordId: proposal.vendor_id,
    recordLabel: `${proposal.field_name}: ${proposal.current_value ?? '—'} → ${proposal.proposed_value ?? '—'}`,
    fieldCorrectionIds: correctionIds,
  })

  return NextResponse.json(updated)
}
