import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth/session'
import { isDbMaster } from '@/lib/assistant/settings'
import { supabaseAdmin } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

// Which of the owner's devices answers. When the laptop and the phone are in the
// same room, both hear "Hey DB"; each asks here first and only the one that gets
// the lease opens and answers. The device in a conversation renews the lease
// every few seconds, so the other stays quiet until it is released.
//
//   claim   (wake word) -- granted only if the lease is free or already ours.
//                          One conditional UPDATE, so two devices asking in the
//                          same instant can't both win.
//   take    (you tapped the mic on this device) -- always granted.
//   renew   -- extends our lease while talking.
//   release -- conversation over.
const LEASE_MS = 20_000

export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser || !(await isDbMaster(sessionUser))) return NextResponse.json({ error: 'DB is private to her owner.' }, { status: 403 })
  const body = await req.json().catch(() => ({}))
  const deviceId = typeof body.device_id === 'string' ? body.device_id.slice(0, 64) : ''
  const label = typeof body.label === 'string' ? body.label.slice(0, 40) : 'device'
  if (!/^[a-z0-9-]{6,64}$/i.test(deviceId)) return NextResponse.json({ error: 'device_id is required' }, { status: 400 })
  const now = new Date()
  const until = new Date(now.getTime() + LEASE_MS).toISOString()
  const table = supabaseAdmin.from('assistant_device_lease')

  if (body.action === 'claim' || body.action === 'take') {
    let q = table.update({ device_id: deviceId, device_label: label, until, updated_at: now.toISOString() }).eq('id', 1)
    if (body.action === 'claim') q = q.or(`until.lt."${now.toISOString()}",device_id.eq.${deviceId}`)
    const { data, error } = await q.select('device_id')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (data && data.length) return NextResponse.json({ granted: true })
    const { data: holder } = await table.select('device_label, until').eq('id', 1).maybeSingle()
    return NextResponse.json({ granted: false, holder: holder?.device_label || 'other device' })
  }
  if (body.action === 'renew') {
    const { data } = await table.update({ until, updated_at: now.toISOString() }).eq('id', 1).eq('device_id', deviceId).select('device_id')
    return NextResponse.json({ granted: !!data?.length })
  }
  if (body.action === 'release') {
    await table.update({ until: now.toISOString(), updated_at: now.toISOString() }).eq('id', 1).eq('device_id', deviceId)
    return NextResponse.json({ released: true })
  }
  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
