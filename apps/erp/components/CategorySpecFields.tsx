'use client'

import { useCustomOptions } from '@/lib/useCustomOptions'
import { SearchableSelect } from '@/components/SearchableSelect'
import { Checkbox } from '@/components/ui/checkbox'
import { getCustomOptionsCategory } from '@/lib/sku-field-options'

// useCustomOptions is a hook, so it can't be called conditionally inside a
// fields.map() loop -- this wrapper isolates the hook call per dropdown-backed
// field so the parent can render a variable-length field list safely.
function CustomOptionSpecField({
  optionsCategory,
  value,
  onChange,
}: {
  optionsCategory: string
  value: string
  onChange: (v: string) => void
}) {
  const { values, addOption } = useCustomOptions(optionsCategory)
  return (
    <SearchableSelect
      options={values}
      value={value ?? ''}
      onChange={onChange}
      onOtherCommit={(v) => { if (!values.includes(v)) addOption(v) }}
    />
  )
}

// Schema-driven per-category spec field renderer -- reads a category's
// `sku_category_templates.field_schema.fields` list and renders the right control per
// field (custom_options-backed searchable dropdown, plain text/number, checkbox, or a
// fixed select). Shared by SKU Master's "New SKU"/"Edit SKU" form and Stock Intake's
// inline new-SKU creation, so the two entry points can never drift apart on which
// fields a category captures again.
export function CategorySpecFields({
  fields,
  specs,
  category,
  onChange,
}: {
  fields: any[]
  specs: Record<string, any>
  category: string
  onChange: (name: string, value: any) => void
}) {
  if (fields.length === 0) {
    return <p className="text-sm text-muted-foreground mb-3">No additional specs for this category.</p>
  }

  return (
    <>
      {fields.map((field: any) => {
        const optionsCategory = getCustomOptionsCategory(category, field.name)
        return (
          <div key={field.name} className="mb-3">
            <label className="block text-sm font-medium">{field.label}</label>
            {optionsCategory ? (
              <CustomOptionSpecField
                optionsCategory={optionsCategory}
                value={specs[field.name]}
                onChange={(v) => onChange(field.name, v)}
              />
            ) : field.type === 'text' || field.type === 'number' ? (
              <input
                type={field.type}
                value={specs[field.name] ?? ''}
                onChange={(e) =>
                  onChange(field.name, field.type === 'number' ? Number(e.target.value) : e.target.value)
                }
                className="border p-2 w-full rounded"
                required={field.required}
              />
            ) : field.type === 'checkbox' ? (
              <Checkbox
                checked={!!specs[field.name]}
                onCheckedChange={(v) => onChange(field.name, !!v)}
              />
            ) : field.type === 'select' ? (
              <select
                value={specs[field.name] || ''}
                onChange={(e) => onChange(field.name, e.target.value)}
                className="border p-2 w-full rounded"
              >
                <option value="">Select...</option>
                {(field.options || []).map((opt: string) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            ) : null}
            <span className="text-xs text-muted-foreground">{field.required ? 'Required' : 'Optional'}</span>
          </div>
        )
      })}
    </>
  )
}

export function parseFieldSchema(schema: any): { fields: any[] } {
  if (typeof schema === 'string') {
    try { return JSON.parse(schema) } catch { return { fields: [] } }
  }
  return schema || { fields: [] }
}
