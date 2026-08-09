import { supabaseAdmin } from './supabase/service'
import { isLikelyDuplicateText, normalizeForComparison } from './text-normalize'

export interface DuplicateCandidate {
  id: string
  full_sku_code: string
  brand: string | null
  model_name: string | null
  quantity_in_stock: number | null
}

// sku_category_templates.field_schema.variant_fields lists the spec fields that
// distinguish real variants within a category (e.g. LAP: cpu/ram/ssd/gpu/
// display_type/screen_size) -- the same fields resolveOrCreateSku() already uses
// via canonicalJson() to decide whether two rows under one base_sku_code are the
// "same" variant. Reusing it here is what stops a same-model-text pair with a
// genuinely different RAM/SSD from being flagged as a duplicate.
async function getVariantFieldsMap(): Promise<Record<string, string[]>> {
  const { data } = await supabaseAdmin.from('sku_category_templates').select('category, field_schema')
  const map: Record<string, string[]> = {}
  for (const row of data || []) {
    let schema: any = row.field_schema
    if (typeof schema === 'string') {
      try { schema = JSON.parse(schema) } catch { schema = null }
    }
    map[row.category] = schema?.variant_fields || []
  }
  return map
}

async function getVariantFields(category: string): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from('sku_category_templates')
    .select('field_schema')
    .eq('category', category)
    .single()
  let schema: any = data?.field_schema
  if (typeof schema === 'string') {
    try { schema = JSON.parse(schema) } catch { schema = null }
  }
  return schema?.variant_fields || []
}

// True if a and b have no CONTRADICTING value on any listed field (normalized).
// A field missing/blank on either side is treated as "no evidence," not a
// mismatch -- older/legacy rows often lack optional fields (display_type, gpu)
// that newer entries do set, and that presence/absence gap alone shouldn't block
// an otherwise-identical pair (same cpu/ram/ssd) from being flagged as a real
// duplicate. Only a genuine value-vs-value conflict (e.g. 256GB vs 128GB SSD)
// counts as evidence they're different configs. An empty `fields` list means the
// category has no declared variant fields -- fall back to text-only matching
// (the caller's isLikelyDuplicateText check) rather than silently suppressing
// detection for that category.
export function specsMatchOnFields(a: Record<string, any>, b: Record<string, any>, fields: string[]): boolean {
  if (fields.length === 0) return true
  for (const f of fields) {
    const av = a?.[f]
    const bv = b?.[f]
    const aEmpty = av === undefined || av === null || av === ''
    const bEmpty = bv === undefined || bv === null || bv === ''
    if (aEmpty || bEmpty) continue
    if (normalizeForComparison(String(av)) !== normalizeForComparison(String(bv))) return false
  }
  return true
}

// Non-blocking check used right after a genuinely new SKU is created (see
// resolveOrCreateSku) -- flags other active SKUs in the same category+brand whose
// model_name looks like the same product under a different spelling AND whose
// variant-distinguishing specs also match, so the caller can surface a "did you
// mean X?" warning without ever delaying or refusing the insert that already
// happened, and without firing on a legitimate different-config sibling variant.
export async function findPossibleDuplicateSkus(params: {
  category: string
  brand: string
  modelName: string
  specifications: Record<string, any>
  excludeId: string
}): Promise<DuplicateCandidate[]> {
  const { category, brand, modelName, specifications, excludeId } = params
  if (!brand || !modelName) return []

  // ilike's pattern-match semantics mean literal % / _ in a brand name would
  // otherwise be treated as wildcards -- escape them so this is an exact,
  // case-insensitive comparison, not a pattern search.
  const escapedBrand = brand.replace(/[%_]/g, (c) => `\\${c}`)

  const [{ data }, variantFields] = await Promise.all([
    supabaseAdmin
      .from('sku_master')
      .select('id, full_sku_code, brand, model_name, specifications, quantity_in_stock')
      .eq('category', category)
      .ilike('brand', escapedBrand)
      .eq('status', 'active')
      .neq('id', excludeId),
    getVariantFields(category),
  ])

  if (!data) return []
  return data
    .filter((row) => row.model_name && isLikelyDuplicateText(row.model_name, modelName))
    .filter((row) => specsMatchOnFields(row.specifications || {}, specifications, variantFields))
    .map(({ id, full_sku_code, brand, model_name, quantity_in_stock }) => ({ id, full_sku_code, brand, model_name, quantity_in_stock }))
}

export { getVariantFieldsMap }
