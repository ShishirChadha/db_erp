export interface SelectedUpgrade {
  rule_id: string
  field_name: string
  from_value: string
  to_value: string
  price_delta: number
}

// jsonb array equality in Postgres is element-order-sensitive (unlike object
// key order, which is normalized) -- every write path that touches
// cart_items.selected_upgrades / order_items.selected_upgrades MUST insert
// this pre-sorted, or two logically-identical selections could be treated as
// different cart lines (or fail to match an existing one).
export function sortSelectedUpgrades(upgrades: SelectedUpgrade[]): SelectedUpgrade[] {
  return [...upgrades].sort((a, b) => a.rule_id.localeCompare(b.rule_id))
}
