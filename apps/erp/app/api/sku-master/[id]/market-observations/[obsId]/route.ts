import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'

// ---------- DELETE: soft-delete/correct a mis-entered observation ----------
// Soft delete (never a hard delete) so a bad entry stays auditable rather than
// vanishing outright, matching the soft-delete convention used everywhere else in
// this schema (purchases.is_deleted, customers.is_deleted, sku_master.status, etc.).
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; obsId: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id, obsId } = await params
  const { error } = await supabaseAdmin
    .from('market_price_observations')
    .update({ is_deleted: true })
    .eq('id', obsId)
    .eq('sku_id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}
