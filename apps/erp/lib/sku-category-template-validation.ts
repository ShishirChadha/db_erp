const VALID_TYPES = ['text', 'number', 'checkbox', 'select', 'textarea']

// Shared by the create (POST) and update (PATCH) sku-category-templates routes --
// keeps `field_schema` shaped the way every reader (CategorySpecFields, sku-code-
// generator, sku-normalizer, sku-duplicate-detector, buildConfigSummary) expects.
export function validateFieldSchema(schema: any): string | null {
  if (!schema || typeof schema !== 'object') return 'field_schema must be an object.'
  const fields = schema.fields
  if (!Array.isArray(fields)) return 'field_schema.fields must be an array.'

  const seenNames = new Set<string>()
  for (const field of fields) {
    if (!field || typeof field !== 'object') return 'Every field must be an object.'
    const name = String(field.name || '').trim()
    const label = String(field.label || '').trim()
    if (!name) return 'Every field needs a machine name.'
    if (!/^[a-z][a-z0-9_]*$/.test(name)) {
      return `Field name "${name}" must be lowercase letters/numbers/underscores, starting with a letter.`
    }
    if (seenNames.has(name)) return `Field name "${name}" is used more than once.`
    seenNames.add(name)
    if (!label) return `Field "${name}" needs a label.`
    if (!VALID_TYPES.includes(field.type)) return `Field "${name}" has an invalid type "${field.type}".`
    if (field.type === 'select' && (!Array.isArray(field.options) || field.options.length === 0)) {
      return `Select field "${name}" needs at least one option.`
    }
    if (field.showIf && (!field.showIf.field || !seenNames.has(field.showIf.field))) {
      return `Field "${name}"'s showIf must reference an earlier field in the list.`
    }
  }

  const variantFields = schema.variant_fields
  if (variantFields !== undefined) {
    if (!Array.isArray(variantFields)) return 'field_schema.variant_fields must be an array.'
    for (const vf of variantFields) {
      if (!seenNames.has(vf)) return `variant_fields references unknown field "${vf}".`
    }
  }

  return null
}

// Existing sku_master.specifications rows are keyed by a field's machine `name` --
// renaming it in place would silently orphan that data rather than migrate it (the
// UI keeps `name` locked once a field is saved, this is defense in depth on the API
// side). Detected positionally: the client is expected to preserve existing fields'
// array order and append new ones at the end, so a name changing at a position that
// existed before is a rename attempt, not a genuine add/remove.
export function findBlockedRenames(oldFields: any[], newFields: any[]): string[] {
  const oldByPosition = new Map<number, string>()
  oldFields.forEach((f, i) => oldByPosition.set(i, f?.name))
  const blocked: string[] = []
  newFields.forEach((f, i) => {
    const oldName = oldByPosition.get(i)
    if (oldName && f?.name && oldName !== f.name) blocked.push(oldName)
  })
  return blocked
}
