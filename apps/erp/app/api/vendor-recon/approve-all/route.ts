import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logFieldCorrections } from '@/lib/field-corrections'
import { logAuditEvent } from '@/lib/audit-log'

// ---------- POST: bulk-accept, scoped to the safe subset ----------
// Only fill_missing + high confidence -- a field that was genuinely empty and is now
// getting its first real value. A conflict (existing value disagrees with the
// invoice) always needs an eyeballed decision, never bulk-approved -- that's the
// whole point of surfacing it side by side rather than auto-applying it.
export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { document_id } = await req.json()
  if (!document_id) return NextResponse.json({ error: 'document_id is required.' }, { status: 400 })

  const { data: proposals, error: fetchErr } = await supabaseAdmin
    .from('vendor_correction_proposals')
    .select('*')
    .eq('document_id', document_id)
    .eq('status', 'pending')
    .eq('change_kind', 'fill_missing')
    .eq('confidence', 'high')
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 })
  if (!proposals || proposals.length === 0) return NextResponse.json({ approved: 0 })

  let approved = 0
  for (const proposal of proposals) {
    const fieldValue = proposal.field_name === 'has_gst' ? proposal.proposed_value === 'true' : proposal.proposed_value
    const { error: updateErr } = await supabaseAdmin.from('vendors').update({ [proposal.field_name]: fieldValue }).eq('id', proposal.vendor_id)
    if (updateErr) continue // one field failing (e.g. a stale FK) shouldn't abort the rest of the batch

    const correctionIds = await logFieldCorrections(
      'vendors',
      proposal.vendor_id,
      [{ field: proposal.field_name, oldValue: proposal.current_value, newValue: proposal.proposed_value }],
      sessionUser.id,
      `Vendor recon bulk-approve from invoice document ${document_id}`
    )

    await supabaseAdmin
      .from('vendor_correction_proposals')
      .update({ status: 'approved', decided_by: sessionUser.id, decided_at: new Date().toISOString(), field_correction_id: correctionIds[0] || null })
      .eq('id', proposal.id)

    await logAuditEvent({
      actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
      actionType: 'update',
      module: 'vendors',
      tableName: 'vendors',
      recordId: proposal.vendor_id,
      recordLabel: `${proposal.field_name}: ${proposal.current_value ?? '—'} → ${proposal.proposed_value ?? '—'} (bulk)`,
      fieldCorrectionIds: correctionIds,
    })
    approved++
  }

  return NextResponse.json({ approved })
}
