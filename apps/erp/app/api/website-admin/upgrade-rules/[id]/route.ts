import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'

// ---------- PATCH: toggle active / update price ----------
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const body = await req.json()
  const { price_delta, is_active } = body as { price_delta?: number; is_active?: boolean }

  const update: Record<string, unknown> = {}
  if (price_delta !== undefined) {
    if (Number(price_delta) < 0) return NextResponse.json({ error: 'price_delta cannot be negative' }, { status: 400 })
    update.price_delta = Number(price_delta)
  }
  if (is_active !== undefined) update.is_active = !!is_active

  const { error } = await supabaseAdmin.from('sku_upgrade_rules').update(update).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}

// ---------- DELETE: remove a rule ----------
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const { error } = await supabaseAdmin.from('sku_upgrade_rules').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
