import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'

// Addresses that showed the storefront's 404 page (logged from visitors' browsers).
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  const { data, error } = await supabaseAdmin.from('seo_404_log').select('*').order('hits', { ascending: false }).order('last_seen', { ascending: false }).limit(100)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

// "Done" -- clear an entry once it has been fixed or redirected.
export async function DELETE(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  const path = req.nextUrl.searchParams.get('path')
  if (!path) return NextResponse.json({ error: 'path is required' }, { status: 400 })
  const { error } = await supabaseAdmin.from('seo_404_log').delete().eq('path', path)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
