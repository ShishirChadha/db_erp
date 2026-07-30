import { supabaseAdmin } from './supabase/service'

export async function generateBaseSkuCode(
  category: string,
  specs: Record<string, any>
): Promise<string> {
  const { data: template } = await supabaseAdmin
    .from('sku_category_templates')
    .select('sku_code_format')
    .eq('category', category)
    .single()

  if (!template?.sku_code_format) {
    const brand = sanitize(specs.brand || 'UNK')
    const model = sanitize(specs.model || 'UNK')
    return `SKU-${category.toUpperCase()}-${brand}-${model}`
  }

  let code = template.sku_code_format
  const placeholders = code.match(/\{(\w+)\}/g) || []
  for (const placeholder of placeholders) {
    const fieldName = placeholder.slice(1, -1)
    let value = specs[fieldName]
    if (value === undefined || value === null || value === '') {
      value = 'UNK'
    } else {
      value = sanitize(String(value))
    }
    code = code.replace(placeholder, value)
  }
  return code
}

function sanitize(s: string): string {
  return s.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-]/g, '').toUpperCase()
}