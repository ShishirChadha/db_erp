import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth/session'
import { isDbMaster } from '@/lib/assistant/settings'
import { supabaseAdmin } from '@/lib/supabase/service'

// DB's learnings -- what she has been taught, in conversations (she offers,
// the owner says yes) or by hand in Settings. All visible, editable, pausable
// and deletable, so nothing she "knows" is hidden from the owner. General
// learnings are applied on every turn (lib/assistant/loop.ts); customer ones
// come with find_customer.

const COLS = 'id, subject_type, subject_id, note, source, is_active, created_at, customers(customer_name)'

async function guard(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  return sessionUser && (await isDbMaster(sessionUser)) ? sessionUser : null
}
const forbidden = () => NextResponse.json({ error: 'DB is private to her owner.' }, { status: 403 })
const cleanNote = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, 500) : '')

export async function GET(req: NextRequest) {
  if (!(await guard(req))) return forbidden()
  let q = supabaseAdmin.from('assistant_notes').select(COLS).order('created_at', { ascending: false }).limit(300)
  if (!req.nextUrl.searchParams.get('all')) q = q.eq('is_active', true)
  const { data } = await q
  return NextResponse.json(data || [])
}

export async function POST(req: NextRequest) {
  const user = await guard(req)
  if (!user) return forbidden()
  const body = await req.json().catch(() => ({}))
  const note = cleanNote(body.note)
  if (note.length < 3) return NextResponse.json({ error: 'Write what DB should remember.' }, { status: 400 })
  const customerId = typeof body.customer_id === 'string' && body.customer_id ? body.customer_id : null
  const { data, error } = await supabaseAdmin.from('assistant_notes')
    .insert({ subject_type: customerId ? 'customer' : 'general', subject_id: customerId, note, created_by: user.id, source: 'manual' })
    .select(COLS).single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data)
}

export async function PATCH(req: NextRequest) {
  if (!(await guard(req))) return forbidden()
  const body = await req.json().catch(() => ({}))
  if (typeof body.id !== 'string') return NextResponse.json({ error: 'id is required' }, { status: 400 })
  const patch: Record<string, unknown> = {}
  if (body.note !== undefined) {
    const note = cleanNote(body.note)
    if (note.length < 3) return NextResponse.json({ error: 'A learning can’t be empty.' }, { status: 400 })
    patch.note = note
  }
  if (typeof body.is_active === 'boolean') patch.is_active = body.is_active
  if (!Object.keys(patch).length) return NextResponse.json({ error: 'Nothing to change.' }, { status: 400 })
  const { data, error } = await supabaseAdmin.from('assistant_notes').update(patch).eq('id', body.id).select(COLS).single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data)
}

// Delete for good (pausing is the PATCH is_active=false).
export async function DELETE(req: NextRequest) {
  if (!(await guard(req))) return forbidden()
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
  const { error } = await supabaseAdmin.from('assistant_notes').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}
