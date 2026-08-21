import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'

const KNOWN_MODULES = ['full', 'sales', 'purchases', 'inventory', 'repairs', 'customers_vendors', 'invoices_quotations']

// IANA offsets we actually need to support -- kept as a small fixed table rather than a
// timezone library dependency. Fixed (non-DST) offset, computed once at save time; a
// DST-observing zone would need re-saving twice a year to stay accurate (documented tradeoff).
const TZ_OFFSET_HOURS: Record<string, number> = {
  'Asia/Kolkata': 5.5,
  UTC: 0,
}

function toUtcCron(frequency: 'daily' | 'weekly', dayOfWeek: number | null, hourLocal: number, timezone: string): string {
  const offset = TZ_OFFSET_HOURS[timezone] ?? 0
  let utcHour = hourLocal - offset
  let dayShift = 0
  if (utcHour < 0) {
    utcHour += 24
    dayShift = -1
  } else if (utcHour >= 24) {
    utcHour -= 24
    dayShift = 1
  }
  const hour = Math.floor(utcHour)
  const minute = Math.round((utcHour - hour) * 60)

  if (frequency === 'daily') return `${minute} ${hour} * * *`

  const dow = ((dayOfWeek ?? 0) + dayShift + 7) % 7
  return `${minute} ${hour} * * ${dow}`
}

export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { data, error } = await supabaseAdmin.from('backup_settings').select('*').eq('id', true).single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function PUT(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const { enabled, frequency, dayOfWeek, hourLocal, modules, retentionCount, timezone } = body

  if (typeof enabled !== 'boolean') return NextResponse.json({ error: 'enabled must be boolean' }, { status: 400 })
  if (frequency !== 'daily' && frequency !== 'weekly') return NextResponse.json({ error: 'frequency must be daily or weekly' }, { status: 400 })
  if (frequency === 'weekly' && (typeof dayOfWeek !== 'number' || dayOfWeek < 0 || dayOfWeek > 6)) {
    return NextResponse.json({ error: 'dayOfWeek (0-6) is required for a weekly schedule' }, { status: 400 })
  }
  if (typeof hourLocal !== 'number' || hourLocal < 0 || hourLocal > 23) return NextResponse.json({ error: 'hourLocal must be 0-23' }, { status: 400 })
  if (!Array.isArray(modules) || modules.length === 0 || modules.some((m: string) => !KNOWN_MODULES.includes(m))) {
    return NextResponse.json({ error: 'modules must be a non-empty array of known module keys' }, { status: 400 })
  }
  if (typeof retentionCount !== 'number' || retentionCount < 1 || retentionCount > 100) {
    return NextResponse.json({ error: 'retentionCount must be 1-100' }, { status: 400 })
  }
  const tz = typeof timezone === 'string' && timezone in TZ_OFFSET_HOURS ? timezone : 'Asia/Kolkata'

  const cronExpression = toUtcCron(frequency, frequency === 'weekly' ? dayOfWeek : null, hourLocal, tz)

  const { data, error } = await supabaseAdmin.rpc('update_backup_settings', {
    p_enabled: enabled,
    p_frequency: frequency,
    p_day_of_week: frequency === 'weekly' ? dayOfWeek : null,
    p_hour_local: hourLocal,
    p_modules: modules,
    p_retention_count: retentionCount,
    p_timezone: tz,
    p_cron_expression: cronExpression,
    p_updated_by: sessionUser.id,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data)
}
