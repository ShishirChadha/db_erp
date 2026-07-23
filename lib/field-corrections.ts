import { supabaseAdmin } from './supabase/service'

// Logs one row per changed field -- generalizes the append-only-ledger pattern
// already used by stock_movements/asset_qc_checks/asset_cost_adjustments to
// correction endpoints that were previously silent plain UPDATEs with no history
// (serial/asset number, sale price/payment fields, SKU master specs/cost).
export async function logFieldCorrections(
  tableName: string,
  recordId: string,
  changes: Array<{ field: string; oldValue: unknown; newValue: unknown }>,
  changedBy: string | null,
  reason?: string | null
) {
  const rows = changes
    .filter((c) => String(c.oldValue ?? '') !== String(c.newValue ?? ''))
    .map((c) => ({
      table_name: tableName,
      record_id: recordId,
      field_name: c.field,
      old_value: c.oldValue === null || c.oldValue === undefined ? null : String(c.oldValue),
      new_value: c.newValue === null || c.newValue === undefined ? null : String(c.newValue),
      changed_by: changedBy,
      reason: reason || null,
    }))
  if (rows.length === 0) return
  await supabaseAdmin.from('field_corrections').insert(rows)
}
