import { supabaseAdmin } from './supabase/service'
import { isLikelyDuplicateText } from './text-normalize'

export interface DuplicateCandidate {
  id: string
  full_sku_code: string
  brand: string | null
  model_name: string | null
  quantity_in_stock: number | null
}

// Non-blocking check used right after a genuinely new SKU is created (see
// resolveOrCreateSku) -- flags other active SKUs in the same category+brand whose
// model_name looks like the same product under a different spelling, so the caller
// can surface a "did you mean X?" warning without ever delaying or refusing the
// insert that already happened.
export async function findPossibleDuplicateSkus(params: {
  category: string
  brand: string
  modelName: string
  excludeId: string
}): Promise<DuplicateCandidate[]> {
  const { category, brand, modelName, excludeId } = params
  if (!brand || !modelName) return []

  // ilike's pattern-match semantics mean literal % / _ in a brand name would
  // otherwise be treated as wildcards -- escape them so this is an exact,
  // case-insensitive comparison, not a pattern search.
  const escapedBrand = brand.replace(/[%_]/g, (c) => `\\${c}`)

  const { data } = await supabaseAdmin
    .from('sku_master')
    .select('id, full_sku_code, brand, model_name, quantity_in_stock')
    .eq('category', category)
    .ilike('brand', escapedBrand)
    .eq('status', 'active')
    .neq('id', excludeId)

  if (!data) return []
  return data.filter((row) => row.model_name && isLikelyDuplicateText(row.model_name, modelName))
}
