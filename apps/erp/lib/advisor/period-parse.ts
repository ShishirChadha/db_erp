// Maps a phrase inside an advisor question to a {from,to,label} range, by keyword-
// matching straight onto the period helpers apps/erp already ships in lib/reports.ts
// -- no new date logic. This is what lets "revenue last fortnight" resolve to exactly
// the same range the Reports page's own fortnight button would give, since both call
// the same function.
import {
  today, yesterday, last7Days, last15Days, monthToDate, lastMonthFull,
  fortnightToDate, previousFortnight, fyToDate,
} from '@/lib/reports'

export interface ParsedPeriod {
  from: string
  to: string
  label: string
}

// Ordered longest/most-specific phrase first, since a naive substring match would
// let "month" inside "last month" match "this month" first otherwise.
const PATTERNS: { re: RegExp; resolve: () => { from: string; to: string }; label: string }[] = [
  { re: /\btoday\b|\baaj\b/i, resolve: today, label: 'Today' },
  { re: /\byesterday\b|\bkal\b/i, resolve: yesterday, label: 'Yesterday' },
  { re: /\blast\s*7\s*days?\b|\bpast\s*week\b/i, resolve: last7Days, label: 'Last 7 days' },
  { re: /\blast\s*15\s*days?\b/i, resolve: last15Days, label: 'Last 15 days' },
  { re: /\bprevious\s*fortnight\b|\blast\s*fortnight\b/i, resolve: previousFortnight, label: 'Previous fortnight' },
  { re: /\bthis\s*fortnight\b|\bfortnight\s*to\s*date\b/i, resolve: fortnightToDate, label: 'This fortnight' },
  { re: /\blast\s*month\b|\bpichhle\s*mahine\b/i, resolve: lastMonthFull, label: 'Last month' },
  { re: /\bthis\s*month\b|\bmonth\s*to\s*date\b|\bmtd\b|\bis\s*mahine\b/i, resolve: monthToDate, label: 'This month' },
  { re: /\bthis\s*(fy|financial\s*year)\b|\bfy\s*to\s*date\b|\bytd\b/i, resolve: fyToDate, label: 'This financial year' },
]

// Default when no period phrase is found: month-to-date, the same default the
// dashboard's own KPI cards open with.
export function parsePeriod(text: string): ParsedPeriod {
  for (const p of PATTERNS) {
    if (p.re.test(text)) {
      const { from, to } = p.resolve()
      return { from, to, label: p.label }
    }
  }
  const { from, to } = monthToDate()
  return { from, to, label: 'This month' }
}
