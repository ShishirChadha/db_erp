import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { supabaseAdmin } from '@/lib/supabase/service'

// What DB has been asked to remember -- visible and removable, so nothing she
// "knows" is hidden from the owner.
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  const { data } = await supabaseAdmin.from('assistant_notes')
    .select('id, subject_type, subject_id, note, created_at, customers(customer_name)')
    .eq('is_active', true).order('created_at', { ascending: false }).limit(200)
  return NextResponse.json(data || [])
}

export async function DELETE(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
  const { error } = await supabaseAdmin.from('assistant_notes').update({ is_active: false }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}
