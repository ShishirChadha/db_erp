import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, canEditPage } from '@/lib/auth/session'

// ---------- PATCH: edit a festival calendar entry ----------
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser || !canEditPage(sessionUser, 'marketing')) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const updates: Record<string, any> = {}
  if ('name' in body) updates.name = String(body.name || '').trim()
  if ('festival_date' in body) {
    if (Number.isNaN(Date.parse(body.festival_date))) return NextResponse.json({ error: 'Invalid festival_date' }, { status: 400 })
    updates.festival_date = body.festival_date
  }
  if ('is_major' in body) updates.is_major = body.is_major !== false

  if (Object.keys(updates).length === 0) return NextResponse.json({ error: 'No fields to update' }, { status: 400 })

  const { data, error } = await supabaseAdmin.from('festival_calendar').update(updates).eq('id', id).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data)
}

// ---------- DELETE: soft-delete a festival calendar entry ----------
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser || !canEditPage(sessionUser, 'marketing')) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const { error } = await supabaseAdmin.from('festival_calendar').update({ is_deleted: true }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}
