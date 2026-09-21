import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'

// ---------- GET/PATCH: the global "max devices at once" cap for manager/employee
// accounts (owner is exempt -- see lib/auth/device-sessions.ts) ----------
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { data } = await supabaseAdmin.from('app_settings').select('value').eq('key', 'max_devices_per_user').maybeSingle()
  return NextResponse.json({ max_devices: data ? parseInt(data.value, 10) : 2 })
}

export async function PATCH(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json()
  const maxDevices = parseInt(body.max_devices, 10)
  if (!Number.isFinite(maxDevices) || maxDevices < 1 || maxDevices > 20) {
    return NextResponse.json({ error: 'max_devices must be between 1 and 20.' }, { status: 400 })
  }

  const { error } = await supabaseAdmin
    .from('app_settings')
    .upsert({ key: 'max_devices_per_user', value: String(maxDevices), updated_at: new Date().toISOString(), updated_by: sessionUser.id }, { onConflict: 'key' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
