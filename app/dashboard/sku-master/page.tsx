'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { apiFetch } from '@/lib/api-client'

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
}

interface CategoryTemplate {
  category: string
  display_name: string
  field_schema: any
  sku_code_format?: string   // <-- added
}

export default function SkuMasterPage() {
  const [skus, setSkus] = useState<SKU[]>([])
  const [templates, setTemplates] = useState<CategoryTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingSku, setEditingSku] = useState<SKU | null>(null)

  const fetchTemplates = useCallback(async () => {
    try {
      const res = await apiFetch('/api/sku-category-templates')
      if (!res.ok) throw new Error('Failed to load templates')
      const data = await res.json()
      setTemplates(data)
    } catch (err: any) {
      console.error(err)
      setError(err.message)
    }
  }, [])

  const fetchSkus = useCallback(async () => {
    try {
      const res = await apiFetch('/api/sku-master')
      if (!res.ok) throw new Error('Failed to fetch SKUs')
      const data = await res.json()
      setSkus(data)
    } catch (err: any) {
      console.error(err)
      setError(err.message)
    }
  }, [])

  useEffect(() => {
    Promise.all([fetchSkus(), fetchTemplates()]).finally(() => setLoading(false))
  }, [fetchSkus, fetchTemplates])

  const handleCreate = () => {
    if (templates.length === 0) {
      alert('No categories available. Seed the database first.')
      return
    }
    setEditingSku(null)
    setModalOpen(true)
  }

  const handleEdit = (sku: SKU) => {
    setEditingSku(sku)
    setModalOpen(true)
  }

  const handleDelete = async (sku: SKU) => {
    if (!confirm(`Permanently delete ${sku.full_sku_code}? This action cannot be undone.`)) return
    await apiFetch(`/api/sku-master/${sku.id}`, { method: 'DELETE' })
    fetchSkus()
  }

  if (loading) return <div className="p-4">Loading…</div>
  if (error) return <div className="p-4 text-red-600">Error: {error}</div>

  return (
    <div className="p-4">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">SKU Master</h1>
        <button onClick={handleCreate} className="bg-blue-600 text-white px-4 py-2 rounded">
          + New SKU
        </button>
      </div>

      <table className="min-w-full border">
        <thead>
          <tr>
            <th className="border p-2">SKU Code</th>
            <th className="border p-2">Description</th>
            <th className="border p-2">Category</th>
            <th className="border p-2">Stock</th>
            <th className="border p-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {skus.map(sku => (
            <tr key={sku.id}>
              <td className="border p-2">{sku.full_sku_code}</td>
              <td className="border p-2">{sku.sku_description}</td>
              <td className="border p-2">{sku.category}</td>
              <td className="border p-2">{sku.quantity_in_stock}</td>
              <td className="border p-2 space-x-2">
                <button onClick={() => handleEdit(sku)} className="text-blue-600 underline">Edit</button>
                <button onClick={() => handleDelete(sku)} className="text-red-600 underline">Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {modalOpen && (
        <SkuFormModal
          templates={templates}
          existingSku={editingSku}
          onClose={() => setModalOpen(false)}
          onSaved={fetchSkus}
        />
      )}
    </div>
  )
}

// ─────────────── MODAL ───────────────
function SkuFormModal({
  templates,
  existingSku,
  onClose,
  onSaved,
}: {
  templates: CategoryTemplate[]
  existingSku: SKU | null
  onClose: () => void
  onSaved: () => void
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
        return '' // abort if any placeholder value missing
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
    onSaved()
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
              disabled={!!existingSku}
            >
              {templates.map(t => (
                <option key={t.category} value={t.category}>{t.display_name}</option>
              ))}
            </select>
          </div>

          {fields.length > 0 ? (
            fields.map((field: any) => (
              <div key={field.name} className="mb-3">
                <label className="block text-sm font-medium">{field.label}</label>
                {field.type === 'text' || field.type === 'number' ? (
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
            ))
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