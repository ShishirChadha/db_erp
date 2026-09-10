import { supabaseAdmin } from '@/lib/supabase/service'

// Category spec field names (used to build specifications->>field filters) rarely
// change -- refetching all of sku_category_templates on every request is pure
// overhead. Same short-TTL in-memory cache pattern as lib/auth/redact.ts's
// redaction-rules cache. Shared by /api/stock's free-text spec search and
// /api/sku-master's structured spec= filter (both need the same validated field-name
// list so a filter can't probe an arbitrary jsonb key).
let specFieldNamesCache: string[] | null = null
let specFieldNamesCacheAt = 0
const SPEC_FIELD_CACHE_TTL_MS = 60_000

export async function getSpecFieldNames(): Promise<string[]> {
  if (specFieldNamesCache && Date.now() - specFieldNamesCacheAt < SPEC_FIELD_CACHE_TTL_MS) {
    return specFieldNamesCache
  }
  const { data: specTemplates } = await supabaseAdmin.from('sku_category_templates').select('field_schema')
  const names = new Set<string>()
  for (const t of specTemplates || []) {
    const fields = (t as any).field_schema?.fields
    if (Array.isArray(fields)) for (const f of fields) if (f?.name) names.add(f.name)
  }
  specFieldNamesCache = [...names]
  specFieldNamesCacheAt = Date.now()
  return specFieldNamesCache
}
