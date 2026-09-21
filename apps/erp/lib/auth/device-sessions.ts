import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'

export const SESSION_COOKIE_NAME = 'db_session_id'

// Lightweight UA -> "Browser on OS" label. Not a full device-fingerprint library --
// this is display-only (Settings > Active Devices), so a rough label is enough and
// avoids adding a new dependency for it.
export function parseDeviceLabel(userAgent: string | null): string {
  if (!userAgent) return 'Unknown device'
  const ua = userAgent

  let browser = 'Unknown browser'
  if (/Edg\//.test(ua)) browser = 'Edge'
  else if (/OPR\//.test(ua)) browser = 'Opera'
  else if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) browser = 'Chrome'
  else if (/CriOS/.test(ua)) browser = 'Chrome'
  else if (/FxiOS/.test(ua)) browser = 'Firefox'
  else if (/Firefox\//.test(ua)) browser = 'Firefox'
  else if (/Safari\//.test(ua) && !/Chrome/.test(ua)) browser = 'Safari'

  let os = 'Unknown OS'
  if (/iPhone|iPad|iPod/.test(ua)) os = 'iOS'
  else if (/Android/.test(ua)) os = 'Android'
  else if (/Mac OS X/.test(ua)) os = 'macOS'
  else if (/Windows/.test(ua)) os = 'Windows'
  else if (/Linux/.test(ua)) os = 'Linux'

  return `${browser} on ${os}`
}

// x-forwarded-for can carry a chain ("client, proxy1, proxy2") behind Vercel's edge --
// the first entry is the original client.
export function getClientIp(req: NextRequest): string | null {
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  return req.headers.get('x-real-ip')
}

// Best-effort approximate city/country from IP -- never blocks login on failure.
// No API key needed (ipapi.co free tier); short timeout since this runs inline
// in the post-login request.
async function geolocateIp(ip: string | null): Promise<string | null> {
  if (!ip || ip === '::1' || ip.startsWith('127.') || ip.startsWith('192.168.') || ip.startsWith('10.')) return null
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 2500)
    const res = await fetch(`https://ipapi.co/${ip}/json/`, { signal: controller.signal })
    clearTimeout(timeout)
    if (!res.ok) return null
    const data = await res.json()
    if (data.error) return null
    const parts = [data.city, data.region, data.country_name].filter(Boolean)
    return parts.length > 0 ? parts.join(', ') : null
  } catch {
    return null
  }
}

async function getMaxDevices(): Promise<number> {
  const { data } = await supabaseAdmin.from('app_settings').select('value').eq('key', 'max_devices_per_user').maybeSingle()
  const n = data ? parseInt(data.value, 10) : NaN
  return Number.isFinite(n) && n > 0 ? n : 2
}

// Called right after a successful login. Owner accounts are tracked (visible in
// Settings > Active Devices) but never auto-kicked -- locking the owner out of
// their own dashboard from a routine new-device login would be worse than the
// problem this feature solves. The cap only applies to manager/employee roles.
export async function registerSession(
  profileId: string,
  role: 'owner' | 'manager' | 'employee',
  req: NextRequest
): Promise<{ sessionId: string; kickedCount: number }> {
  const userAgent = req.headers.get('user-agent')
  const ip = getClientIp(req)
  const [location, maxDevices] = await Promise.all([geolocateIp(ip), getMaxDevices()])

  let kickedCount = 0
  if (role !== 'owner') {
    const { data: active } = await supabaseAdmin
      .from('user_sessions')
      .select('id')
      .eq('profile_id', profileId)
      .is('revoked_at', null)
      .order('last_seen_at', { ascending: true })

    const activeSessions = active || []
    // A new login makes activeSessions.length + 1 total -- kick the oldest ones
    // down to (maxDevices - 1) so the new one fits within the cap.
    const excess = activeSessions.length - (maxDevices - 1)
    if (excess > 0) {
      const toRevoke = activeSessions.slice(0, excess).map(s => s.id)
      await supabaseAdmin
        .from('user_sessions')
        .update({ revoked_at: new Date().toISOString(), revoked_reason: 'device_limit' })
        .in('id', toRevoke)
      kickedCount = toRevoke.length
    }
  }

  const { data: inserted } = await supabaseAdmin
    .from('user_sessions')
    .insert({
      profile_id: profileId,
      device_label: parseDeviceLabel(userAgent),
      user_agent: userAgent,
      ip_address: ip,
      location,
    })
    .select('id')
    .single()

  return { sessionId: inserted!.id, kickedCount }
}

export async function revokeSession(sessionId: string, reason: string): Promise<void> {
  await supabaseAdmin
    .from('user_sessions')
    .update({ revoked_at: new Date().toISOString(), revoked_reason: reason })
    .eq('id', sessionId)
    .is('revoked_at', null)
}

// Throttled so this doesn't turn into a write on every single authenticated
// request -- only touches the row if it's been a while since the last update.
export async function touchSessionIfStale(sessionId: string): Promise<void> {
  const { data } = await supabaseAdmin.from('user_sessions').select('last_seen_at').eq('id', sessionId).maybeSingle()
  if (!data) return
  const staleMs = Date.now() - new Date(data.last_seen_at).getTime()
  if (staleMs > 5 * 60 * 1000) {
    await supabaseAdmin.from('user_sessions').update({ last_seen_at: new Date().toISOString() }).eq('id', sessionId)
  }
}

// Returns false only when the cookie names a session that exists and is revoked --
// a missing cookie (pre-feature session, or a non-browser caller) is treated as
// valid so this rollout never locks out an already-logged-in browser mid-session.
export async function isSessionRevoked(sessionId: string | undefined): Promise<boolean> {
  if (!sessionId) return false
  const { data } = await supabaseAdmin.from('user_sessions').select('revoked_at').eq('id', sessionId).maybeSingle()
  if (!data) return false
  return data.revoked_at !== null
}
