import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { liveSessionByCode, readJsonLimited } from '@/lib/qc-agent/session'
import type { LiveSnapshot } from '@/lib/qc-agent/types'

// POST -- the script's heartbeat every ~3 s while the laptop is being tested:
// what is plugged in right now + the background tests' progress. Answers with
// any pending request from the test page (brightness sweep). Code-only.
//
// Only the script writes `live` and `background_results`, so the sticky
// merge below (ports seen so far, LAN seen up, most monitors seen) can't race
// the test page, which only writes interactive_results.

const str = (v: unknown, max = 300) => (typeof v === 'string' ? v.slice(0, max) : undefined)

export async function POST(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const found = await liveSessionByCode(code)
  if ('error' in found) return found.error
  const parsed = await readJsonLimited(req)
  if ('error' in parsed) return parsed.error
  const { row } = found
  const inc = (parsed.body.live || {}) as LiveSnapshot
  const prev = (row.live || {}) as LiveSnapshot

  const usb = Array.isArray(inc.usb)
    ? inc.usb.slice(0, 30).map((u) => ({ id: str(u?.id) || '', name: str(u?.name), path: str(u?.path) }))
    : []
  const seen = [...(prev.usb_seen || [])]
  for (const u of usb) {
    if (u.path && !seen.some((s) => s.path === u.path)) seen.push({ path: u.path, name: u.name })
  }
  const live: LiveSnapshot = {
    usb,
    monitors_active: typeof inc.monitors_active === 'number' ? inc.monitors_active : null,
    ethernet_up: typeof inc.ethernet_up === 'boolean' ? inc.ethernet_up : null,
    on_ac: typeof inc.on_ac === 'boolean' ? inc.on_ac : null,
    battery_percent: typeof inc.battery_percent === 'number' ? inc.battery_percent : null,
    usb_seen: seen.slice(0, 20),
    ethernet_seen_up: !!prev.ethernet_seen_up || inc.ethernet_up === true,
    monitors_max: Math.max(prev.monitors_max || 0, typeof inc.monitors_active === 'number' ? inc.monitors_active : 0),
  }

  const update: Record<string, unknown> = { live, live_at: new Date().toISOString() }
  if (parsed.body.background && typeof parsed.body.background === 'object') update.background_results = parsed.body.background

  const { error } = await supabaseAdmin.from('qc_agent_sessions').update(update).eq('id', row.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    command: row.interactive_results?.command ?? null,
    page_finished: !!row.interactive_results?.finished,
    stop: false,
  })
}
