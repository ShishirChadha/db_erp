import { Role } from './session'

// Fields stripped from API responses for any non-owner role. Keyed by a logical table/shape
// name (not always a literal SQL table -- e.g. 'stock_list' is /api/stock's flattened shape).
const SENSITIVE_FIELDS = {
  sku_master: ['base_cost'],
  stock_list: ['cost_price', 'vendor_id', 'vendor_name', 'gst_percentage', 'unit_price', 'line_total', 'purchased_by_type'],
  accessories: ['unit_cost', 'supplier'],
} as const

type RedactableShape = keyof typeof SENSITIVE_FIELDS

export function redactForRole<T extends Record<string, any>>(row: T, shape: RedactableShape, role: Role): T {
  if (role === 'owner') return row
  const clone: any = { ...row }
  for (const field of SENSITIVE_FIELDS[shape]) {
    delete clone[field]
  }
  return clone
}

export function redactManyForRole<T extends Record<string, any>>(rows: T[], shape: RedactableShape, role: Role): T[] {
  return rows.map((row) => redactForRole(row, shape, role))
}
