// Spec values that mean "not applicable" in the ERP's dropdown lists ("No" for
// a laptop's GPU or generation, etc.). Valid data for staff, but they must
// never reach customer-facing copy: product titles, alt text, JSON-LD.
const PLACEHOLDER_VALUES = new Set(['no', 'n/a', 'na', 'none', 'null', 'nil', '-', '--', '—', 'not applicable'])

export function isPlaceholderValue(value: unknown): boolean {
  if (value === undefined || value === null) return true
  if (typeof value !== 'string') return false
  const v = value.trim().toLowerCase()
  return v === '' || PLACEHOLDER_VALUES.has(v)
}

// Same specifications object with placeholder values removed.
export function cleanSpecifications(
  specifications: Record<string, any> | null | undefined
): Record<string, any> | null {
  if (!specifications) return null
  return Object.fromEntries(Object.entries(specifications).filter(([, value]) => !isPlaceholderValue(value)))
}

// Cleans an already-built " / "-joined config title (e.g. a web_title that was
// auto-filled before placeholders were filtered): drops every " / No"-style
// segment, leaving the rest of the title intact.
export function stripPlaceholderSegments(title: string): string {
  if (!title.includes(' / ')) return title
  const [head, ...rest] = title.split(' / ')
  return [head, ...rest.filter((segment) => !isPlaceholderValue(segment))].join(' / ')
}
