import { supabaseAdmin } from './supabase/service'
import { normalizeSpecifications } from './sku-normalizer'
import { generateBaseSkuCode } from './sku-code-generator'

// JSON.stringify is key-order-sensitive, but Postgres JSONB does not preserve
// insertion order on round-trip -- so comparing raw stringify output against a value
// just read back from the DB can wrongly report two logically-identical spec objects
// as different. Sort keys recursively before stringifying to compare by value instead.
// Also drop explicitly-undefined-valued keys (e.g. an optional form field never set),
// matching native JSON.stringify semantics -- otherwise a freshly-built object (which
// still has those keys in memory) never matches the same object read back from the DB
// (where JSON serialization already dropped them on insert).
export function canonicalJson(value: any): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort()
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

interface ResolveSkuInput {
  category: string
  item_type?: string
  brand?: string
  model_name?: string
  specifications: Record<string, any>
  base_cost?: number | null
  selling_price_default?: number | null
  reorder_level?: number
  sku_description?: string
  hsn_code?: string | null
}

/**
 * Resolve specs to an existing sku_master variant if one matches exactly (by
 * normalized specifications), otherwise create a new variant under the category's
 * base SKU code. Shared by the SKU-catalog "new SKU" flow and any other entry path
 * (e.g. the legacy quick-purchase form) that needs to land on a sku_master row.
 */
export async function resolveOrCreateSku(
  input: ResolveSkuInput
): Promise<{ sku: any; created: boolean }> {
  const normalizedSpecs = await normalizeSpecifications(input.category, input.specifications || {})
  const baseSkuCode = await generateBaseSkuCode(input.category, normalizedSpecs)

  const { data: existing } = await supabaseAdmin
    .from('sku_master')
    .select('variant_number, specifications')
    .eq('base_sku_code', baseSkuCode)
    .order('variant_number', { ascending: true })

  let variantNumber = 1

  if (existing && existing.length > 0) {
    const newSpecsNorm = canonicalJson(normalizedSpecs)
    for (const variant of existing) {
      if (canonicalJson(variant.specifications) === newSpecsNorm) {
        const { data: existingSku } = await supabaseAdmin
          .from('sku_master')
          .select('*')
          .eq('base_sku_code', baseSkuCode)
          .eq('variant_number', variant.variant_number)
          .single()
        return { sku: existingSku, created: false }
      }
    }
    variantNumber = existing[existing.length - 1].variant_number + 1
  }

  const fullSkuCode = `${baseSkuCode}-${String(variantNumber).padStart(3, '0')}`

  const { data: newSku, error: insertErr } = await supabaseAdmin
    .from('sku_master')
    .insert({
      base_sku_code: baseSkuCode,
      variant_number: variantNumber,
      full_sku_code: fullSkuCode,
      category: input.category,
      item_type: input.item_type || input.category,
      brand: input.brand || '',
      model_name: input.model_name || '',
      specifications: normalizedSpecs,
      sku_description: input.sku_description || `${input.brand} ${input.model_name}`,
      base_cost: input.base_cost ?? null,
      selling_price_default: input.selling_price_default ?? null,
      reorder_level: input.reorder_level ?? 5,
      quantity_in_stock: 0,
      hsn_code: input.hsn_code ?? null,
    })
    .select()
    .single()

  if (insertErr) throw insertErr

  return { sku: newSku, created: true }
}
