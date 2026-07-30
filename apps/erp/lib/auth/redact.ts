import { Role } from './session'
import { supabaseAdmin } from '@/lib/supabase/service'

// Fields stripped from API responses for non-owner roles, per an owner-configurable policy
// in the `redaction_rules` table (Settings -> Field Redaction). Keyed by a logical
// table/shape name (not always a literal SQL table -- e.g. 'stock_list' is /api/stock's
// flattened shape).
export type RedactableShape = 'sku_master' | 'stock_list' | 'accessories'

interface RedactionRule {
  shape: string
  field_name: string
  hidden_from_employee: boolean
  hidden_from_manager: boolean
}

let rulesCache: RedactionRule[] | null = null
let rulesCacheAt = 0
const CACHE_TTL_MS = 60_000

export function invalidateRedactionRulesCache() {
  rulesCache = null
  rulesCacheAt = 0
}

async function getRules(): Promise<RedactionRule[]> {
  if (rulesCache && Date.now() - rulesCacheAt < CACHE_TTL_MS) return rulesCache
  const { data } = await supabaseAdmin
    .from('redaction_rules')
    .select('shape, field_name, hidden_from_employee, hidden_from_manager')
  rulesCache = data || []
  rulesCacheAt = Date.now()
  return rulesCache
}

export async function redactForRole<T extends Record<string, any>>(row: T, shape: RedactableShape, role: Role): Promise<T> {
  if (role === 'owner') return row
  const rules = await getRules()
  const clone: any = { ...row }
  for (const rule of rules) {
    if (rule.shape !== shape) continue
    const hide = role === 'manager' ? rule.hidden_from_manager : rule.hidden_from_employee
    if (hide) delete clone[rule.field_name]
  }
  return clone
}

export async function redactManyForRole<T extends Record<string, any>>(rows: T[], shape: RedactableShape, role: Role): Promise<T[]> {
  if (role === 'owner') return rows
  const rules = await getRules()
  return rows.map((row) => {
    const clone: any = { ...row }
    for (const rule of rules) {
      if (rule.shape !== shape) continue
      const hide = role === 'manager' ? rule.hidden_from_manager : rule.hidden_from_employee
      if (hide) delete clone[rule.field_name]
    }
    return clone
  })
}
