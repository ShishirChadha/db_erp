// Single source of truth for which digest sections exist, what they're called,
// and which roles may receive them. Used by: the settings API (to strip
// disallowed blocks from a saved subscription), build.ts (to decide which
// report_* RPCs to call), render.ts (to decide what to print), and the
// Settings -> Digests UI (to render the right checkboxes per person).
export interface DigestBlockDef {
  id: string
  label: string
  // Roles that may ever receive this block -- mirrors the redaction rule used
  // everywhere else: cost/vendor/margin stays owner-only, revenue/units/stock
  // are visible to every role (selling price is not a redacted field).
  roles: Array<'owner' | 'manager' | 'employee'>
  chart?: 'bar' | 'segmented'
}

export const DIGEST_BLOCKS: DigestBlockDef[] = [
  { id: 'kpis', label: 'Revenue, units, collections, outstanding', roles: ['owner', 'manager', 'employee'] },
  { id: 'trend', label: 'Revenue trend (chart)', roles: ['owner', 'manager', 'employee'], chart: 'bar' },
  { id: 'category_breakdown', label: 'Revenue by category (chart)', roles: ['owner', 'manager', 'employee'], chart: 'bar' },
  { id: 'staff_breakdown', label: 'Revenue by staff (chart)', roles: ['owner', 'manager', 'employee'], chart: 'bar' },
  { id: 'sale_type_split', label: 'GST vs Cash split (chart)', roles: ['owner', 'manager', 'employee'], chart: 'segmented' },
  { id: 'inventory', label: 'Stock levels (sellable / QC pending / on hand)', roles: ['owner', 'manager', 'employee'] },
  { id: 'receivables', label: 'Receivables ageing', roles: ['owner', 'manager'] },
  { id: 'margin', label: 'Gross margin & cost coverage', roles: ['owner'] },
  { id: 'purchasing', label: 'Vendor spend (chart)', roles: ['owner'], chart: 'bar' },
  { id: 'data_health', label: 'Data health flags', roles: ['owner'] },
]

export const DEFAULT_BLOCKS_BY_ROLE: Record<'owner' | 'manager' | 'employee', string[]> = {
  owner: ['kpis', 'trend', 'margin', 'inventory', 'category_breakdown'],
  manager: ['kpis', 'trend', 'inventory', 'category_breakdown'],
  employee: ['kpis', 'inventory'],
}

export function allowedBlocksForRole(role: 'owner' | 'manager' | 'employee'): string[] {
  return DIGEST_BLOCKS.filter((b) => b.roles.includes(role)).map((b) => b.id)
}

// Filters a requested block list down to what this role may actually receive --
// used both when saving a subscription and again at send time (defense in depth:
// a role change after a subscription was saved must not leak a stale block).
export function sanitizeBlocks(requested: string[] | null | undefined, role: 'owner' | 'manager' | 'employee'): string[] {
  const allowed = allowedBlocksForRole(role)
  const filtered = Array.isArray(requested) ? requested.filter((b) => allowed.includes(b)) : []
  return filtered.length > 0 ? filtered : DEFAULT_BLOCKS_BY_ROLE[role]
}
