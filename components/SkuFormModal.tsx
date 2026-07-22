'use client'

import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '@/lib/api-client'
import { useCustomOptions } from '@/lib/useCustomOptions'
import { SearchableSelect } from '@/components/SearchableSelect'

interface SKU {
  id: string
  full_sku_code: string
  base_sku_code: string
  variant_number: number
  category: string
  item_type: string
  brand: string
  model_name: string
  specifications: any
  sku_description: string
  base_cost: number | null
  selling_price_default: number | null
  quantity_in_stock: number
  reorder_level: number
  hsn_code?: string | null
}

interface CategoryTemplate {
  category: string
  display_name: string
  field_schema: any
  sku_code_format?: string
}

// Maps a (sku category code, field name) pair to a custom_options category slug.
// Returns null for fields with no dropdown equivalent (brand, model, HSN, gpu, os,
// etc.) -- those fall through to the existing text/number/select/checkbox
// rendering unchanged.
function getCustomOptionsCategory(skuCategory: string, fieldName: string): string | null {
  if (fieldName === 'cpu') return 'cpu'
  if (fieldName === 'generation') return 'generation'
  if (fieldName === 'ram') return 'ram'
  if (fieldName === 'ssd') return 'storage'
  if (fieldName === 'screen_size' && skuCategory === 'LAP') return 'screen_size_laptop'
  if (fieldName === 'size' && skuCategory === 'MON') return 'screen_size_monitor'
  return null
}

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
  const { values } = useCustomOptions(optionsCategory)
  return <SearchableSelect options={values} value={value ?? ''} onChange={onChange} />
}

export function SkuFormModal({
  templates,
  existingSku,
  onClose,
  onSaved,
}: {
  templates: CategoryTemplate[]
  existingSku: SKU | null
  onClose: () => void
  onSaved: (sku: SKU) => void
}) {
  const defaultCategory =
    existingSku?.category ??
    (templates.some(t => t.category === 'LAP') ? 'LAP' : templates[0]?.category) ??
    ''

  const [category, setCategory] = useState(defaultCategory)
  const [specs, setSpecs] = useState<any>(existingSku?.specifications || {})
  const [skuCode, setSkuCode] = useState(existingSku?.full_sku_code || '')
  const [description, setDescription] = useState(existingSku?.sku_description || '')
  const [descManuallyEdited, setDescManuallyEdited] = useState(false)
  const [hsnCode, setHsnCode] = useState(existingSku?.hsn_code || '')

  const selectedTemplate = templates.find(t => t.category === category)

  const parseFieldSchema = (schema: any) => {
    if (typeof schema === 'string') {
      try { return JSON.parse(schema) } catch { return { fields: [] } }
    }
    return schema || { fields: [] }
  }
  const fieldSchema = parseFieldSchema(selectedTemplate?.field_schema)
  const fields = fieldSchema?.fields || []

  // ─── SKU Generation (category‑aware) ───
  const skuFormat = selectedTemplate?.sku_code_format || ''

  const generatedSku = useMemo(() => {
    if (!skuFormat) return ''
    let preview = skuFormat

    const placeholders = preview.match(/\{(\w+)\}/g) || []
    for (const ph of placeholders) {
      const fieldName = ph.slice(1, -1)
      let rawValue = specs[fieldName]

      if (rawValue === undefined || rawValue === null || rawValue === '') {
        return ''
      }

      const sanitized = String(rawValue)
        .replace(/\s+/g, '-')
        .replace(/[^a-zA-Z0-9-]/g, '')
        .toUpperCase()

      preview = preview.replace(ph, sanitized)
    }

    return existingSku ? existingSku.full_sku_code : preview + '-???'
  }, [skuFormat, specs, existingSku, category])

  useEffect(() => {
    if (!existingSku && skuCode === '') {
      setSkuCode(generatedSku)
    }
  }, [generatedSku, existingSku])

  // ─── Auto‑generated description ───
  const generatedDescription = useMemo(() => {
    if (!selectedTemplate || !fields.length) return ''
    const parts: string[] = []
    fields.forEach((field: any) => {
      const value = specs[field.name]
      if (value !== undefined && value !== '' && value !== null) {
        let displayVal = value
        if (typeof value === 'boolean') displayVal = value ? 'Yes' : 'No'
        else if (typeof value === 'number') displayVal = value.toString()
        parts.push(displayVal)
      }
    })
    return parts.join('  ')
  }, [specs, fields, selectedTemplate])

  useEffect(() => {
    if (!existingSku && !descManuallyEdited) {
      setDescription(generatedDescription)
    }
  }, [generatedDescription, existingSku, descManuallyEdited])

  const handleSpecChange = (name: string, value: any) => {
    setSpecs((prev: any) => ({ ...prev, [name]: value }))
  }

  const handleDescriptionChange = (val: string) => {
    setDescription(val)
    setDescManuallyEdited(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const payload: any = {
      category,
      item_type: selectedTemplate?.display_name || category,
      brand: specs.brand || '',
      model_name: specs.model || '',
      sku_description: description,
      specifications: specs,
      hsn_code: hsnCode,
    }
    if (!existingSku) {
      payload.manual_sku_code = skuCode || generatedSku
    } else {
      payload.full_sku_code = skuCode || existingSku.full_sku_code
    }
    const url = existingSku ? `/api/sku-master/${existingSku.id}` : '/api/sku-master'
    const method = existingSku ? 'PUT' : 'POST'
    const res = await apiFetch(url, { method, body: JSON.stringify(payload) })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      alert(err.error || 'Save failed')
      return
    }
    const data = await res.json()
    onSaved(existingSku ? data : data.sku)
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white p-6 rounded shadow-lg max-w-xl w-full max-h-screen overflow-y-auto">
        <h2 className="text-xl font-bold mb-4">{existingSku ? 'Edit SKU' : 'New SKU'}</h2>
        <form onSubmit={handleSubmit}>
          <div className="mb-3">
            <label className="block text-sm font-medium">Category</label>
            <select
              value={category}
              onChange={(e) => {
                setCategory(e.target.value)
                if (!existingSku) setSpecs({})
              }}
              className="border p-2 w-full rounded"
            >
              {templates.map(t => (
                <option key={t.category} value={t.category}>{t.display_name}</option>
              ))}
            </select>
          </div>

          {fields.length > 0 ? (
            fields.map((field: any) => {
              const optionsCategory = getCustomOptionsCategory(category, field.name)
              return (
                <div key={field.name} className="mb-3">
                  <label className="block text-sm font-medium">{field.label}</label>
                  {optionsCategory ? (
                    <CustomOptionSpecField
                      optionsCategory={optionsCategory}
                      value={specs[field.name]}
                      onChange={(v) => handleSpecChange(field.name, v)}
                    />
                  ) : field.type === 'text' || field.type === 'number' ? (
                    <input
                      type={field.type}
                      value={specs[field.name] ?? ''}
                      onChange={(e) =>
                        handleSpecChange(field.name, field.type === 'number' ? Number(e.target.value) : e.target.value)
                      }
                      className="border p-2 w-full rounded"
                      required={field.required}
                    />
                  ) : field.type === 'checkbox' ? (
                    <input
                      type="checkbox"
                      checked={!!specs[field.name]}
                      onChange={(e) => handleSpecChange(field.name, e.target.checked)}
                    />
                  ) : field.type === 'select' ? (
                    <select
                      value={specs[field.name] || ''}
                      onChange={(e) => handleSpecChange(field.name, e.target.value)}
                      className="border p-2 w-full rounded"
                    >
                      <option value="">Select...</option>
                      {(field.options || []).map((opt: string) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  ) : null}
                  <span className="text-xs text-gray-500">{field.required ? 'Required' : 'Optional'}</span>
                </div>
              )
            })
          ) : (
            <p className="text-sm text-gray-500 mb-3">No additional specs for this category.</p>
          )}

          <div className="mb-3">
            <label className="block text-sm font-medium">SKU Code</label>
            <input
              type="text"
              value={skuCode}
              onChange={(e) => setSkuCode(e.target.value)}
              className="border p-2 w-full rounded bg-gray-50"
              placeholder={generatedSku || 'Fill all required specs to auto-generate'}
            />
            {generatedSku && (
              <p className="text-xs text-gray-500 mt-1">Auto: {generatedSku} (you can edit above)</p>
            )}
          </div>

          <div className="mb-3">
            <label className="block text-sm font-medium">Description</label>
            <input
              type="text"
              value={description}
              onChange={(e) => handleDescriptionChange(e.target.value)}
              className="border p-2 w-full rounded"
              placeholder={generatedDescription || 'Auto‑generated from specs'}
            />
          </div>

          {/* HSN Code */}
          <div className="mb-3">
            <label className="block text-sm font-medium">HSN Code</label>
            <input
              type="text"
              value={hsnCode}
              onChange={(e) => setHsnCode(e.target.value)}
              className="border p-2 w-full rounded"
              placeholder="e.g., 84713010"
            />
          </div>

          <div className="flex justify-end space-x-2 mt-4">
            <button type="button" onClick={onClose} className="px-4 py-2 border rounded">Cancel</button>
            <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded">
              {existingSku ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
