// lib/sku-normalizer.ts
import { supabaseAdmin } from './supabase/service'

interface NormalizationRule {
  type: 'exact' | 'regex'
  map?: Record<string, string>   // for exact
  pattern?: string               // for regex
}

interface FieldDef {
  name: string
  normalization?: NormalizationRule
}

/**
 * For a given category, load its template and apply normalization to the specs.
 */
export async function normalizeSpecifications(
  category: string,
  specs: Record<string, any>
): Promise<Record<string, any>> {
  // Fetch the field schema for the category
  const { data: template } = await supabaseAdmin
    .from('sku_category_templates')
    .select('field_schema')
    .eq('category', category)
    .single()

  if (!template || !template.field_schema) return specs // nothing to normalize

  // Parse field_schema (may be JSON string)
  let schema: any = template.field_schema
  if (typeof schema === 'string') {
    try { schema = JSON.parse(schema) } catch { return specs }
  }
  const fields: FieldDef[] = schema.fields || []

  const normalized = { ...specs }

  for (const field of fields) {
    if (!field.normalization) continue
    const rawValue = normalized[field.name]
    if (rawValue === undefined || rawValue === null) continue

    const { type, map, pattern } = field.normalization

    if (type === 'exact' && map) {
      // normalize the string (case‑insensitive)
      const key = String(rawValue).toLowerCase().trim()
      if (map[key]) {
        normalized[field.name] = map[key]
      }
    } else if (type === 'regex' && pattern) {
      try {
        const regex = new RegExp(pattern)
        const match = String(rawValue).match(regex)
        if (match) {
          // If the field's base type is 'number', convert the matched string to number
          // (we can infer from the field object that we'll add a `type` property, but for now assume any matched group is a number string)
          const extracted = match[1] || match[0]
          // Check if the original field type is number (from the field definition we can't be sure, but we'll treat as number if the parsed value is numeric)
          const asNumber = Number(extracted)
          normalized[field.name] = isNaN(asNumber) ? extracted : asNumber
        }
      } catch (e) {
        // Invalid regex – ignore
      }
    }
  }

  return normalized
}