/**
 * Document-number comparison key.
 *
 * Uppercases and strips every non-alphanumeric character, so a number that
 * differs only in punctuation still matches. This is not hypothetical tidiness:
 * this data contains 'DBI2026/27--00705' (a double hyphen, 17 characters, which
 * the GST portal rejects outright) alongside correctly formed siblings, and a
 * plain upper(trim()) comparison would report it as two different invoices.
 */
export function docNumberKey(value: string | null | undefined): string {
  return String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/**
 * Trailing digits of a document number, as a number.
 *
 * A secondary key for the case where prefixes drift between systems (Zoho
 * writing 'DBI/2026-27/0684' where the ERP holds 'DBI2026/27-00684'): the
 * sequence is the part that is actually stable. Deliberately a fallback, never
 * the primary key -- on its own it would collide across financial years.
 */
export function docNumberSeq(value: string | null | undefined): number | null {
  const m = String(value ?? '').match(/(\d+)\s*$/)
  if (!m) return null
  const n = parseInt(m[1], 10)
  return Number.isFinite(n) ? n : null
}

/** Within tolerance, treating null as zero. */
export function withinTolerance(a: any, b: any, absTolerance: number): boolean {
  return Math.abs((Number(a) || 0) - (Number(b) || 0)) <= absTolerance
}

/** Whole days between two dates, or null if either is missing/unparseable. */
export function dayGap(a: string | null | undefined, b: string | null | undefined): number | null {
  if (!a || !b) return null
  const da = new Date(a).getTime(), db = new Date(b).getTime()
  if (Number.isNaN(da) || Number.isNaN(db)) return null
  return Math.round(Math.abs(da - db) / 86400000)
}
