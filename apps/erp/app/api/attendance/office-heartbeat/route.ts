import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getTrustedClientIp } from '@/lib/attendance-network'
import { logAuditEvent } from '@/lib/audit-log'

// Self-updating office network.
//
// The shop's ISP rotates its public IP (see backups/20261017_attendance_network_
// heartbeat.sql for the history), so a hand-kept allowlist keeps locking the team
// out. The HP ProDesk shares the shop's router, so its egress IP IS the shop's.
// scripts/prodesk/office-heartbeat.sh POSTs here every minute; this records the
// IP we OBSERVE on the request.
//
// Why this is safe to accept without a user session:
//   - The recorded IP is getTrustedClientIp() -- the proxy-set header -- never a
//     value from the body, so the caller cannot register an address other than
//     the one it is actually calling from.
//   - Registering requires a shared secret that lives only on the ProDesk and in
//     this app's env. Without ATTENDANCE_HEARTBEAT_SECRET set the route is off.
//   - A heartbeat row only counts for 12 hours (attendance_ip_allowed), and the
//     owner can still switch any row off in Settings.
//
// An owner-deactivated heartbeat row stays deactivated: we refresh last_seen_at
// but never flip is_active back on.

const STALE_PRUNE_DAYS = 30

function secretOk(provided: string | null): boolean {
  const expected = process.env.ATTENDANCE_HEARTBEAT_SECRET
  if (!expected || !provided) return false
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function POST(req: NextRequest) {
  if (!process.env.ATTENDANCE_HEARTBEAT_SECRET) {
    return NextResponse.json({ error: 'Heartbeat is not configured on this server.' }, { status: 501 })
  }
  if (!secretOk(req.headers.get('x-heartbeat-secret'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const ip = getTrustedClientIp(req)
  if (!ip) {
    return NextResponse.json({ error: 'Could not determine the caller IP.' }, { status: 400 })
  }
  const cidr = `${ip}/${ip.includes(':') ? 128 : 32}`
  const now = new Date().toISOString()

  const touch = () => supabaseAdmin
    .from('attendance_networks')
    .update({ last_seen_at: now })
    .eq('source', 'heartbeat').eq('cidr', cidr)
    .select('id')

  const { data: touched, error: touchErr } = await touch()
  if (touchErr) {
    // 22P02 = the header held something that is not an IP.
    if (touchErr.code === '22P02') return NextResponse.json({ error: 'Invalid IP.' }, { status: 400 })
    return NextResponse.json({ error: touchErr.message }, { status: 500 })
  }
  if (touched && touched.length > 0) return NextResponse.json({ ok: true, ip, new: false })

  // First time we have seen this address: record it, once, in the audit trail.
  const { data: created, error: insErr } = await supabaseAdmin
    .from('attendance_networks')
    .insert({
      label: 'Shop (auto)',
      cidr,
      source: 'heartbeat',
      last_seen_at: now,
      notes: 'Reported by the shop server. Refreshed every minute; counts for 12 hours after the last report.',
    })
    .select('id')
    .single()

  if (insErr) {
    // Lost a race with a concurrent heartbeat for the same new address.
    if (insErr.code === '23505') {
      await touch()
      return NextResponse.json({ ok: true, ip, new: false })
    }
    return NextResponse.json({ error: insErr.message }, { status: 500 })
  }

  await logAuditEvent({
    actor: { id: null, role: 'system' },
    actionType: 'create', module: 'attendance', tableName: 'attendance_networks',
    recordId: created.id, recordLabel: `Shop (auto) (${cidr}) -- new address reported by the shop server`,
  })

  // Housekeeping only on the rare insert path, not every minute.
  const cutoff = new Date(Date.now() - STALE_PRUNE_DAYS * 86_400_000).toISOString()
  await supabaseAdmin.from('attendance_networks')
    .delete().eq('source', 'heartbeat').lt('last_seen_at', cutoff)

  return NextResponse.json({ ok: true, ip, new: true })
}
