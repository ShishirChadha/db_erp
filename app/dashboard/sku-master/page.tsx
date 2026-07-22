'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { apiFetch } from '@/lib/api-client'
import { SkuFormModal } from '@/components/SkuFormModal'
import RequirePageAccess from '@/components/RequirePageAccess'

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

type SortField = 'full_sku_code' | 'sku_description' | 'category' | 'quantity_in_stock'
type SortOrder = 'asc' | 'desc'

function SkuMasterPage() {
  const [skus, setSkus] = useState<SKU[]>([])
  const [templates, setTemplates] = useState<CategoryTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingSku, setEditingSku] = useState<SKU | null>(null)
  const searchParams = useSearchParams()
  const [search, setSearch] = useState(searchParams.get('search') || '')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [sortField, setSortField] = useState<SortField>('full_sku_code')
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc')

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
      const params = new URLSearchParams()
      if (search) params.append('search', search)
      const res = await apiFetch(`/api/sku-master?${params.toString()}`)
      if (!res.ok) throw new Error('Failed to fetch SKUs')
      const data = await res.json()
      setSkus(data)
    } catch (err: any) {
      console.error(err)
      setError(err.message)
    }
  }, [search])

  useEffect(() => {
    fetchTemplates()
  }, [fetchTemplates])

  useEffect(() => {
    fetchSkus().finally(() => setLoading(false))
  }, [fetchSkus])

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortOrder('asc')
    }
  }

  const displayedSkus = useMemo(() => {
    const filtered = categoryFilter ? skus.filter((s) => s.category === categoryFilter) : skus
    const sorted = [...filtered].sort((a, b) => {
      const av = a[sortField]
      const bv = b[sortField]
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      if (typeof av === 'number' && typeof bv === 'number') return av - bv
      return String(av).localeCompare(String(bv))
    })
    return sortOrder === 'asc' ? sorted : sorted.reverse()
  }, [skus, categoryFilter, sortField, sortOrder])

  const sortIndicator = (field: SortField) => (sortField === field ? (sortOrder === 'asc' ? ' ↑' : ' ↓') : '')

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

      <div className="flex flex-wrap gap-4 mb-4 items-end">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Category</label>
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="border p-2 rounded">
            <option value="">All Categories</option>
            {templates.map((t) => (
              <option key={t.category} value={t.category}>{t.display_name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Search</label>
          <input
            type="text"
            placeholder="Search code or description..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="border p-2 rounded"
          />
        </div>
        {(categoryFilter || search) && (
          <button
            onClick={() => { setCategoryFilter(''); setSearch('') }}
            className="text-sm text-gray-500 underline"
          >
            Clear filters
          </button>
        )}
      </div>

      <table className="min-w-full border">
        <thead>
          <tr>
            <th className="border p-2 cursor-pointer select-none" onClick={() => toggleSort('full_sku_code')}>
              SKU Code{sortIndicator('full_sku_code')}
            </th>
            <th className="border p-2 cursor-pointer select-none" onClick={() => toggleSort('sku_description')}>
              Description{sortIndicator('sku_description')}
            </th>
            <th className="border p-2">HSN</th>
            <th className="border p-2 cursor-pointer select-none" onClick={() => toggleSort('category')}>
              Category{sortIndicator('category')}
            </th>
            <th className="border p-2 cursor-pointer select-none" onClick={() => toggleSort('quantity_in_stock')}>
              Stock{sortIndicator('quantity_in_stock')}
            </th>
            <th className="border p-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {displayedSkus.map(sku => (
            <tr key={sku.id}>
              <td className="border p-2">{sku.full_sku_code}</td>
              <td className="border p-2">{sku.sku_description}</td>
              <td className="border p-2">{sku.hsn_code || '—'}</td>
              <td className="border p-2">{sku.category}</td>
              <td className="border p-2">{sku.quantity_in_stock ?? '0'}</td>
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
          onSaved={() => fetchSkus()}
        />
      )}
    </div>
  )
}

export default function SkuMasterPageGuarded() {
  return (
    <RequirePageAccess pageKey="sku_master">
      <SkuMasterPage />
    </RequirePageAccess>
  )
}