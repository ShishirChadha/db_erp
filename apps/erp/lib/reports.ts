// Shared period helpers for the reporting layer. All periods are computed in
// server-local time (India Standard Time is this business's only timezone) and
// resolve to plain YYYY-MM-DD date strings, since every reporting RPC takes
// `date` params, not timestamps -- sale_date/po_date are `date` columns.
//
// Financial year here follows financialYear() from @db/shared (Apr-Mar), not
// calendar year -- the old Reports page used calendar year, which is wrong for
// an Indian business's YTD/FY-to-date figures.
import { financialYear } from '@db/shared'

// Formats using the Date object's LOCAL fields, not toISOString() (UTC). Every
// period boundary in this file is deliberately constructed at local midnight
// (`new Date(y, m, d)`) to match this file's "server-local time" contract -- for
// IST (UTC+5:30), local midnight on the 1st is 18:30 UTC the day BEFORE, so a
// UTC-based toISOString().slice(0,10) silently shifted every month/fortnight/week
// boundary back by one calendar day (e.g. "month to date" starting on the 31st of
// the prior month instead of the 1st). Formatting from local fields is immune to
// that regardless of what the server's OS timezone happens to be.
export function toDateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function today(): { from: string; to: string } {
  const d = toDateStr(new Date())
  return { from: d, to: d }
}

export function yesterday(): { from: string; to: string } {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  const s = toDateStr(d)
  return { from: s, to: s }
}

export function last7Days(): { from: string; to: string } {
  const to = new Date()
  const from = new Date()
  from.setDate(from.getDate() - 6)
  return { from: toDateStr(from), to: toDateStr(to) }
}

export function last15Days(): { from: string; to: string } {
  const to = new Date()
  const from = new Date()
  from.setDate(from.getDate() - 14)
  return { from: toDateStr(from), to: toDateStr(to) }
}

export function monthToDate(ref = new Date()): { from: string; to: string } {
  const from = new Date(ref.getFullYear(), ref.getMonth(), 1)
  return { from: toDateStr(from), to: toDateStr(ref) }
}

export function lastMonthFull(ref = new Date()): { from: string; to: string } {
  const from = new Date(ref.getFullYear(), ref.getMonth() - 1, 1)
  const to = new Date(ref.getFullYear(), ref.getMonth(), 0)
  return { from: toDateStr(from), to: toDateStr(to) }
}

// Monday-Sunday, the most recently fully-closed week (not "last 7 rolling days") --
// mirrors the same closed-calendar-period pattern as previousFortnight() below.
export function previousWeek(ref = new Date()): { from: string; to: string } {
  const day = ref.getDay() // 0=Sun..6=Sat
  const daysSinceMonday = (day + 6) % 7
  const thisMonday = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() - daysSinceMonday)
  const prevMonday = new Date(thisMonday)
  prevMonday.setDate(thisMonday.getDate() - 7)
  const prevSunday = new Date(thisMonday)
  prevSunday.setDate(thisMonday.getDate() - 1)
  return { from: toDateStr(prevMonday), to: toDateStr(prevSunday) }
}

// Fixed half-months, since cron has no "every 15 days" primitive -- 1st-15th and
// 16th-end-of-month, matching the digest schedule described in the reporting plan.
export function fortnightToDate(ref = new Date()): { from: string; to: string } {
  const day = ref.getDate()
  const from = day <= 15
    ? new Date(ref.getFullYear(), ref.getMonth(), 1)
    : new Date(ref.getFullYear(), ref.getMonth(), 16)
  return { from: toDateStr(from), to: toDateStr(ref) }
}

export function previousFortnight(ref = new Date()): { from: string; to: string } {
  const day = ref.getDate()
  if (day <= 15) {
    // previous fortnight = 16th-end of prior month
    const from = new Date(ref.getFullYear(), ref.getMonth() - 1, 16)
    const to = new Date(ref.getFullYear(), ref.getMonth(), 0)
    return { from: toDateStr(from), to: toDateStr(to) }
  }
  const from = new Date(ref.getFullYear(), ref.getMonth(), 1)
  const to = new Date(ref.getFullYear(), ref.getMonth(), 15)
  return { from: toDateStr(from), to: toDateStr(to) }
}

// Apr 1 of the FY start year -> ref date. financialYear() returns e.g. "2026-27";
// we only need the start year, which is the part before the dash.
export function fyToDate(ref = new Date()): { from: string; to: string } {
  const fyStartYear = parseInt(financialYear(ref).split('-')[0], 10)
  const from = new Date(fyStartYear, 3, 1) // April 1
  return { from: toDateStr(from), to: toDateStr(ref) }
}

// Last Month to-date: 1st of the previous month through the same day-of-month
// as `ref` (clamped to that month's last day, e.g. Jan 31 -> Feb 28), for an
// apples-to-apples "how far we'd gotten by this point last month" comparison --
// deliberately not lastMonthFull(), which is the whole closed month.
export function lastMonthToDate(ref = new Date()): { from: string; to: string } {
  const from = new Date(ref.getFullYear(), ref.getMonth() - 1, 1)
  const daysInLastMonth = new Date(ref.getFullYear(), ref.getMonth(), 0).getDate()
  const to = new Date(ref.getFullYear(), ref.getMonth() - 1, Math.min(ref.getDate(), daysInLastMonth))
  return { from: toDateStr(from), to: toDateStr(to) }
}

// Last FY to-date: same Apr 1 -> same calendar day, one financial year earlier --
// the YTD figure's year-over-year comparison.
export function lastYearToDate(ref = new Date()): { from: string; to: string } {
  const fyStartYear = parseInt(financialYear(ref).split('-')[0], 10) - 1
  const from = new Date(fyStartYear, 3, 1) // April 1, prior FY
  const to = new Date(ref.getFullYear() - 1, ref.getMonth(), ref.getDate())
  return { from: toDateStr(from), to: toDateStr(to) }
}

export function prevPeriod(from: string, to: string): { from: string; to: string } {
  const f = new Date(from)
  const t = new Date(to)
  const days = Math.round((t.getTime() - f.getTime()) / 86400000) + 1
  const prevTo = new Date(f)
  prevTo.setDate(prevTo.getDate() - 1)
  const prevFrom = new Date(prevTo)
  prevFrom.setDate(prevFrom.getDate() - days + 1)
  return { from: toDateStr(prevFrom), to: toDateStr(prevTo) }
}

export const REPORT_DIMENSIONS = ['brand', 'category', 'staff', 'entity', 'sale_type', 'customer', 'vendor', 'expense_type', 'expense_vendor'] as const
export type ReportDimension = (typeof REPORT_DIMENSIONS)[number]
