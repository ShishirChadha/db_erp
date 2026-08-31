import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'

// ---------- POST: reject one proposal -- no write to vendors, just closes it out ----------
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const { data: proposal } = await supabaseAdmin.from('vendor_correction_proposals').select('status').eq('id', id).single()
  if (!proposal) return NextResponse.json({ error: 'Proposal not found' }, { status: 404 })
  if (proposal.status !== 'pending') return NextResponse.json({ error: `This proposal is already ${proposal.status}.` }, { status: 409 })

  const { data: updated, error } = await supabaseAdmin
    .from('vendor_correction_proposals')
    .update({ status: 'rejected', decided_by: sessionUser.id, decided_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(updated)
}
