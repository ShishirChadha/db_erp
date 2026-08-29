// Shared period helpers for the reporting layer. All periods are computed in
// server-local time (India Standard Time is this business's only timezone) and
// resolve to plain YYYY-MM-DD date strings, since every reporting RPC takes
// `date` params, not timestamps -- sale_date/po_date are `date` columns.
//
// Financial year here follows financialYear() from @db/shared (Apr-Mar), not
// calendar year -- the old Reports page used calendar year, which is wrong for
// an Indian business's YTD/FY-to-date figures.
import { financialYear } from '@db/shared'

export function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10)
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

export const REPORT_DIMENSIONS = ['brand', 'category', 'staff', 'entity', 'sale_type', 'customer', 'vendor'] as const
export type ReportDimension = (typeof REPORT_DIMENSIONS)[number]
