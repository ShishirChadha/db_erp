export interface ConfigSummaryField {
  name: string
  label: string
  type?: string
}

export interface ConfigSummaryTemplate {
  category: string
  field_schema: any
}

function parseFieldSchema(schema: any): { fields: ConfigSummaryField[] } {
  if (typeof schema === 'string') {
    try { return JSON.parse(schema) } catch { return { fields: [] } }
  }
  return schema || { fields: [] }
}

// Builds a human-readable configuration string from a SKU's stored specifications,
// e.g. `Dell Latitude 5400 — i5 / 8GB / 256GB SSD / 14" Non-Touch`. Purely
// computed from sku_master.specifications + sku_category_templates.field_schema --
// no stored data, no migration. sku_description stays a separate free-text field;
// this is what should be shown wherever a row's configuration needs to be legible
// (Stock/Live Stock lists, SKU Master, unit pickers) instead of a raw description
// column that's often just "Migrated item" or a bare brand+model string.
export function buildConfigSummary(
  category: string | null | undefined,
  specifications: Record<string, any> | null | undefined,
  templates: ConfigSummaryTemplate[]
): string {
  const specs = specifications || {}
  const template = templates.find((t) => t.category === category)
  if (!template) return ''
  const { fields } = parseFieldSchema(template.field_schema)

  const parts: string[] = []
  for (const field of fields) {
    // brand/model are folded into the leading segment, not repeated in the spec list.
    if (field.name === 'brand' || field.name === 'model') continue
    const value = specs[field.name]
    if (value === undefined || value === null || value === '') continue
    if (typeof value === 'boolean') {
      if (value) parts.push(field.label || field.name)
      continue
    }
    parts.push(field.name === 'screen_size' ? `${value}"` : String(value))
  }

  const brandModel = [specs.brand, specs.model].filter(Boolean).join(' ')
  return [brandModel, parts.join(' / ')].filter(Boolean).join(' — ')
}
