// Owner-only config for the Marketing Content Studio's generation defaults. Mirrors
// app/api/settings/digests/route.ts's shape (GET returns current state, PUT
// validates and writes it) for a singleton settings row.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'

export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { data, error } = await supabaseAdmin.from('marketing_settings').select('*').eq('id', true).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data)
}

export async function PUT(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const updates: Record<string, any> = { updated_at: new Date().toISOString() }
  for (const key of ['brand_voice', 'default_cta', 'contact_block', 'disclaimer', 'default_warranty_label']) {
    if (key in body) updates[key] = body[key]
  }
  if ('hashtag_bank' in body) updates.hashtag_bank = Array.isArray(body.hashtag_bank) ? body.hashtag_bank : []
  if ('whatsapp_flavor_lines' in body) updates.whatsapp_flavor_lines = Array.isArray(body.whatsapp_flavor_lines) ? body.whatsapp_flavor_lines : []
  if ('daily_generation_cap' in body) {
    const cap = Number(body.daily_generation_cap)
    if (!Number.isFinite(cap) || cap < 1) return NextResponse.json({ error: 'daily_generation_cap must be a positive number' }, { status: 400 })
    updates.daily_generation_cap = Math.floor(cap)
  }

  const { data, error } = await supabaseAdmin.from('marketing_settings').update(updates).eq('id', true).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data)
}
