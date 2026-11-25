import { NextRequest, NextResponse } from 'next/server'
import { liveSessionByCode } from '@/lib/qc-agent/session'
import { deviceKind, parseBrand, parseModel, platformOf } from '@/lib/qc-agent/parse'
import { macModel } from '@/lib/qc-agent/mac-models'

// GET -- what the no-login /qc-test page on the laptop needs: which steps
// apply to this machine, what's plugged in right now, background progress,
// and the answers saved so far. Code-only. Nothing cost- or vendor-related
// exists in this row to leak.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const found = await liveSessionByCode(code)
  if ('error' in found) return found.error
  const { row } = found
  const r = row.hardware_report
  const brand = r ? parseBrand(r.system?.manufacturer) : ''
  const platform = platformOf(r)
  const known = macModel(r?.mac?.model_identifier)
  const liveAgeMs = row.live_at ? Date.now() - new Date(row.live_at).getTime() : null

  return NextResponse.json({
    code: row.code,
    reported: !!r,
    script_connected: liveAgeMs != null && liveAgeMs < 20_000,
    options: row.options || {},
    machine: r
      ? {
          device: deviceKind(r),
          platform,
          // null = model not in the table: ask, don't assume.
          has_touch_bar: platform === 'mac' ? (known ? !!known.touchBar : null) : false,
          has_touch_id: platform === 'mac' ? (known ? !!known.touchId : null) : false,
          name: `${brand} ${parseModel(r, brand)}`.trim(),
          serial: r.bios?.serial || '',
          touch: !!r.touch,
          has_camera: (r.cameras || []).length > 0,
          has_battery: !!r.battery?.present,
          has_lan: (r.net || []).some((n) => n.media === 'ethernet'),
          // Only ask about the BIOS password by hand when Windows couldn't tell us.
          // Macs have no BIOS prompt to ask about (the firmware password is its own check).
          bios_password_known: platform === 'mac' || r.bios_password?.set === true || r.bios_password?.set === false,
        }
      : null,
    background: {
      stage: row.background_results?.stage ?? null,
      stage_progress: row.background_results?.stage_progress ?? null,
    },
    live: row.live || null,
    interactive: row.interactive_results || {},
  })
}
