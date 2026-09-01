'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api-client'
import { Checkbox } from '@/components/ui/checkbox'

interface TemplateField {
  name: string
  label: string
  type: 'text' | 'number' | 'checkbox' | 'select' | 'textarea'
  required?: boolean
  options?: string[]
  showIf?: { field: string; equals: any }
}

interface Template {
  category: string
  display_name: string
  sku_code_format: string
  field_schema: { fields: TemplateField[]; variant_fields?: string[] }
}

const FIELD_TYPES: TemplateField['type'][] = ['text', 'number', 'checkbox', 'select', 'textarea']

function slugify(label: string) {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

const emptyNewField = { label: '', name: '', type: 'text' as TemplateField['type'], required: false, options: '', variant: false, showIfField: '' }

// Owner-only editor for `sku_category_templates` -- the schema that drives every
// SKU spec form (New SKU, Stock Intake's inline create, PO wizard's create-new-SKU
// all share CategorySpecFields.tsx, which reads this table). `category` and each
// field's machine `name` are immutable once created (see the PATCH route) since
// sku_master.specifications rows are already keyed by them.
export default function SkuCategoryTemplatesManager() {
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const [displayName, setDisplayName] = useState('')
  const [skuCodeFormat, setSkuCodeFormat] = useState('')
  const [draftFields, setDraftFields] = useState<TemplateField[]>([])
  const [draftVariantFields, setDraftVariantFields] = useState<string[]>([])
  const [newField, setNewField] = useState(emptyNewField)

  const [showNewCategory, setShowNewCategory] = useState(false)
  const [newCategoryCode, setNewCategoryCode] = useState('')
  const [newCategoryName, setNewCategoryName] = useState('')

  const fetchTemplates = async () => {
    setLoading(true)
    const res = await apiFetch('/api/sku-category-templates')
    if (res.ok) setTemplates(await res.json())
    setLoading(false)
  }

  useEffect(() => { fetchTemplates() }, [])

  const selectedTemplate = templates.find((t) => t.category === selected) || null

  const selectCategory = (category: string) => {
    const t = templates.find((tt) => tt.category === category)
    if (!t) return
    setSelected(category)
    setDisplayName(t.display_name)
    setSkuCodeFormat(t.sku_code_format)
    setDraftFields(t.field_schema?.fields || [])
    setDraftVariantFields(t.field_schema?.variant_fields || [])
    setNewField(emptyNewField)
    setError('')
  }

  const saveCategoryInfo = async () => {
    if (!selected || busy) return
    setBusy(true)
    setError('')
    try {
      const res = await apiFetch(`/api/sku-category-templates/${selected}`, {
        method: 'PATCH',
        body: JSON.stringify({ display_name: displayName, sku_code_format: skuCodeFormat }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to save.')
      await fetchTemplates()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const saveFields = async () => {
    if (!selected || busy) return
    setBusy(true)
    setError('')
    try {
      const res = await apiFetch(`/api/sku-category-templates/${selected}`, {
        method: 'PATCH',
        body: JSON.stringify({ field_schema: { fields: draftFields, variant_fields: draftVariantFields } }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to save fields.')
      await fetchTemplates()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const updateField = (index: number, patch: Partial<TemplateField>) => {
    setDraftFields((prev) => prev.map((f, i) => (i === index ? { ...f, ...patch } : f)))
  }

  const moveField = (index: number, dir: -1 | 1) => {
    setDraftFields((prev) => {
      const next = [...prev]
      const target = index + dir
      if (target < 0 || target >= next.length) return prev
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  const removeField = (index: number) => {
    const field = draftFields[index]
    if (!confirm(`Remove "${field.label}"? Existing SKUs keep whatever value they already have saved for this field in the database -- it just stops being shown or editable going forward.`)) return
    setDraftFields((prev) => prev.filter((_, i) => i !== index))
    setDraftVariantFields((prev) => prev.filter((n) => n !== field.name))
  }

  const toggleVariant = (name: string) => {
    setDraftVariantFields((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]))
  }

  const addField = () => {
    const label = newField.label.trim()
    const name = (newField.name.trim() || slugify(label))
    if (!label || !name) { setError('New field needs a label.'); return }
    if (draftFields.some((f) => f.name === name)) { setError(`Field name "${name}" already exists in this category.`); return }
    if (newField.type === 'select' && !newField.options.trim()) { setError('Select fields need at least one option (comma-separated).'); return }

    const field: TemplateField = {
      name,
      label,
      type: newField.type,
      required: newField.required,
    }
    if (newField.type === 'select') field.options = newField.options.split(',').map((o) => o.trim()).filter(Boolean)
    if (newField.showIfField) field.showIf = { field: newField.showIfField, equals: true }

    setDraftFields((prev) => [...prev, field])
    if (newField.variant) setDraftVariantFields((prev) => [...prev, name])
    setNewField(emptyNewField)
    setError('')
  }

  const createCategory = async () => {
    if (busy) return
    const category = newCategoryCode.trim().toUpperCase()
    const display_name = newCategoryName.trim()
    if (!category || !display_name) { setError('Category code and display name are required.'); return }
    setBusy(true)
    setError('')
    try {
      const res = await apiFetch('/api/sku-category-templates', {
        method: 'POST',
        body: JSON.stringify({ category, display_name, field_schema: { fields: [], variant_fields: [] } }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to create category.')
      setShowNewCategory(false)
      setNewCategoryCode('')
      setNewCategoryName('')
      await fetchTemplates()
      selectCategory(category)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  // Boolean/checkbox fields already added are the only sensible showIf targets --
  // a "reveal these fields once this box is checked" pattern (e.g. Desktop's
  // includes_monitor -> monitor_brand/size/resolution).
  const checkboxFieldNames = draftFields.filter((f) => f.type === 'checkbox').map((f) => f.name)

  if (loading) return <p className="text-sm text-muted-foreground">Loading...</p>

  return (
    <div>
      <p className="text-sm text-muted-foreground mb-4">
        Every SKU category's spec fields (New SKU, Stock Intake's inline create, and the PO wizard's create-new-SKU all read this) live here. A category code and a field's machine name are locked once created -- existing SKUs are already keyed by them.
      </p>

      {error && <div className="text-destructive text-sm mb-3">{error}</div>}

      <div className="flex flex-col md:flex-row gap-4">
        <div className="md:w-56 shrink-0">
          <div className="border rounded divide-y mb-2">
            {templates.map((t) => (
              <button
                key={t.category}
                onClick={() => selectCategory(t.category)}
                className={`w-full text-left p-2 text-sm ${selected === t.category ? 'bg-info/15 font-medium' : 'hover:bg-muted'}`}
              >
                {t.display_name} <span className="text-muted-foreground font-mono text-xs">({t.category})</span>
              </button>
            ))}
          </div>
          {!showNewCategory ? (
            <button onClick={() => setShowNewCategory(true)} className="text-sm text-primary">+ New Category</button>
          ) : (
            <div className="border rounded p-2 space-y-2">
              <input
                value={newCategoryCode}
                onChange={(e) => setNewCategoryCode(e.target.value)}
                placeholder="Code, e.g. WEBCAM"
                className="border p-1 w-full rounded text-sm"
              />
              <input
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                placeholder="Display name"
                className="border p-1 w-full rounded text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Works immediately for New SKU / Stock Intake / PO wizard's create-new-SKU. A developer still needs to register it as serialized-or-quantity-only, and add it to the legacy Purchases quick-entry dialog's Type dropdown if needed there too.
              </p>
              <div className="flex gap-2">
                <button onClick={createCategory} disabled={busy} className="bg-primary text-primary-foreground px-3 py-1 rounded text-sm disabled:opacity-50">Create</button>
                <button onClick={() => setShowNewCategory(false)} className="text-sm text-muted-foreground">Cancel</button>
              </div>
            </div>
          )}
        </div>

        {selectedTemplate && (
          <div className="flex-1 min-w-0 space-y-6">
            <div className="border rounded p-3">
              <h3 className="font-medium mb-2 text-sm">Category Info</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
                <div>
                  <label className="block text-xs text-muted-foreground">Display Name</label>
                  <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="border p-1 w-full rounded text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground">SKU Code Format</label>
                  <input value={skuCodeFormat} onChange={(e) => setSkuCodeFormat(e.target.value)} className="border p-1 w-full rounded text-sm font-mono" />
                </div>
              </div>
              <button onClick={saveCategoryInfo} disabled={busy} className="bg-primary text-primary-foreground px-3 py-1 rounded text-sm disabled:opacity-50">Save Category Info</button>
            </div>

            <div className="border rounded p-3">
              <h3 className="font-medium mb-2 text-sm">Fields</h3>
              <div className="border rounded divide-y mb-3">
                {draftFields.length === 0 && <p className="text-sm text-muted-foreground p-2">No fields yet.</p>}
                {draftFields.map((field, i) => (
                  <div key={field.name} className="p-2 flex flex-wrap items-center gap-2 text-sm">
                    <div className="flex flex-col shrink-0">
                      <button onClick={() => moveField(i, -1)} disabled={i === 0} className="text-xs disabled:opacity-30">▲</button>
                      <button onClick={() => moveField(i, 1)} disabled={i === draftFields.length - 1} className="text-xs disabled:opacity-30">▼</button>
                    </div>
                    <input
                      value={field.label}
                      onChange={(e) => updateField(i, { label: e.target.value })}
                      className="border p-1 rounded flex-1 min-w-[120px]"
                    />
                    <span className="font-mono text-xs text-muted-foreground" title="Machine name (locked)">{field.name}</span>
                    <select value={field.type} onChange={(e) => updateField(i, { type: e.target.value as TemplateField['type'] })} className="border p-1 rounded">
                      {FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                    {field.type === 'select' && (
                      <input
                        value={(field.options || []).join(', ')}
                        onChange={(e) => updateField(i, { options: e.target.value.split(',').map((o) => o.trim()).filter(Boolean) })}
                        placeholder="options, comma-separated"
                        className="border p-1 rounded flex-1 min-w-[140px]"
                      />
                    )}
                    <label className="flex items-center gap-1 text-xs">
                      <Checkbox checked={!!field.required} onCheckedChange={(v) => updateField(i, { required: !!v })} />
                      Required
                    </label>
                    <label className="flex items-center gap-1 text-xs">
                      <Checkbox checked={draftVariantFields.includes(field.name)} onCheckedChange={() => toggleVariant(field.name)} />
                      Variant
                    </label>
                    <button onClick={() => removeField(i)} className="text-destructive text-xs">Remove</button>
                  </div>
                ))}
              </div>

              <div className="border rounded p-2 space-y-2 bg-muted">
                <p className="text-xs font-medium text-muted-foreground">+ Add Field</p>
                <div className="flex flex-wrap gap-2">
                  <input
                    value={newField.label}
                    onChange={(e) => setNewField((f) => ({ ...f, label: e.target.value, name: f.name || slugify(e.target.value) }))}
                    placeholder="Label"
                    className="border p-1 rounded text-sm flex-1 min-w-[120px]"
                  />
                  <input
                    value={newField.name}
                    onChange={(e) => setNewField((f) => ({ ...f, name: slugify(e.target.value) }))}
                    placeholder="machine_name"
                    className="border p-1 rounded text-sm font-mono w-40"
                  />
                  <select value={newField.type} onChange={(e) => setNewField((f) => ({ ...f, type: e.target.value as TemplateField['type'] }))} className="border p-1 rounded text-sm">
                    {FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  {newField.type === 'select' && (
                    <input
                      value={newField.options}
                      onChange={(e) => setNewField((f) => ({ ...f, options: e.target.value }))}
                      placeholder="options, comma-separated"
                      className="border p-1 rounded text-sm flex-1 min-w-[140px]"
                    />
                  )}
                  {checkboxFieldNames.length > 0 && (
                    <select value={newField.showIfField} onChange={(e) => setNewField((f) => ({ ...f, showIfField: e.target.value }))} className="border p-1 rounded text-sm">
                      <option value="">Always show</option>
                      {checkboxFieldNames.map((n) => <option key={n} value={n}>Only if "{n}" checked</option>)}
                    </select>
                  )}
                  <label className="flex items-center gap-1 text-xs">
                    <Checkbox checked={newField.required} onCheckedChange={(v) => setNewField((f) => ({ ...f, required: !!v }))} />
                    Required
                  </label>
                  <label className="flex items-center gap-1 text-xs">
                    <Checkbox checked={newField.variant} onCheckedChange={(v) => setNewField((f) => ({ ...f, variant: !!v }))} />
                    Variant
                  </label>
                  <button onClick={addField} className="bg-foreground text-background px-3 py-1 rounded text-sm">Add</button>
                </div>
              </div>

              <button onClick={saveFields} disabled={busy} className="mt-3 bg-primary text-primary-foreground px-3 py-1 rounded text-sm disabled:opacity-50">Save Fields</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
