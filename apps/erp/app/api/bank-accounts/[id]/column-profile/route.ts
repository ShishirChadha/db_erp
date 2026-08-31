import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'

// ---------- GET: the saved column-mapping profile for this account, if any ----------
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const { data, error } = await supabaseAdmin
    .from('bank_column_profiles')
    .select('*')
    .eq('bank_account_id', id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// ---------- POST: save (or replace) the column-mapping profile for this account ----------
// One profile per account -- the owner maps columns once on first upload, and every
// later statement from that account reuses it. Saving again overwrites (the export
// format doesn't usually change; if it does, this route intentionally lets the owner
// fix it going forward without needing a separate "edit" endpoint).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const body = await req.json()
  const { column_map, date_format, amount_style, header_fingerprint, source_format } = body
  if (!column_map || typeof column_map !== 'object') return NextResponse.json({ error: 'column_map is required.' }, { status: 400 })

  await supabaseAdmin.from('bank_column_profiles').delete().eq('bank_account_id', id)
  const { data, error } = await supabaseAdmin
    .from('bank_column_profiles')
    .insert({
      bank_account_id: id,
      source_format: source_format || 'csv',
      column_map,
      date_format: date_format || 'DD/MM/YYYY',
      amount_style: amount_style || 'split_dr_cr',
      header_fingerprint: header_fingerprint || null,
      created_by: sessionUser.id,
    })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
