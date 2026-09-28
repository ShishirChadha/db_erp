'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { invalidateListPageSizeCache, DEFAULT_LIST_PAGE_SIZE } from '@/lib/useListPageSize'

const MIN_PAGE_SIZE = 50
const MAX_PAGE_SIZE = 500

// Owner-only tab: one global rows-per-page value used by every paginated list page
// in the ERP (Stock, Live Stock, Sales, Customers, Vendors, Invoices, Purchases,
// Purchase Orders, SKU Master, Rentals, Repair Jobs, Expenses, Quotations,
// Replacement Jobs, Audit Log, Accessories, Sold Accessories, Backup History). See
// lib/useListPageSize.ts (the hook every one of those pages reads this through)
// and app/api/settings/list-page-size/route.ts.
export default function ListPageSizeManager() {
  const [pageSize, setPageSize] = useState<number | ''>('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const fetchPageSize = useCallback(async () => {
    setLoading(true)
    const res = await apiFetch('/api/settings/list-page-size')
    if (res.ok) setPageSize((await res.json()).page_size)
    setLoading(false)
  }, [])

  useEffect(() => { fetchPageSize() }, [fetchPageSize])

  const save = async () => {
    if (pageSize === '' || pageSize < MIN_PAGE_SIZE || pageSize > MAX_PAGE_SIZE) {
      setError(`Must be between ${MIN_PAGE_SIZE} and ${MAX_PAGE_SIZE}.`)
      return
    }
    setSaving(true)
    setSaved(false)
    setError('')
    const res = await apiFetch('/api/settings/list-page-size', {
      method: 'PATCH',
      body: JSON.stringify({ page_size: pageSize }),
    })
    if (res.ok) {
      invalidateListPageSizeCache()
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } else {
      setError((await res.json().catch(() => ({}))).error || 'Failed to save.')
    }
    setSaving(false)
  }

  return (
    <div className="space-y-6">
      <div className="rounded-md border p-4 max-w-md space-y-2">
        <label className="text-sm font-medium">Rows per page</label>
        <p className="text-xs text-muted-foreground">
          Applies to every list page across the ERP (Stock, Sales, Customers, Vendors,
          Invoices, Purchases, Purchase Orders, SKU Master, Rentals, Repair Jobs,
          Expenses, and more). Minimum {MIN_PAGE_SIZE} rows. Takes effect the next time
          each page loads -- a page already open keeps its current setting until you
          navigate back to it.
        </p>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : (
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={MIN_PAGE_SIZE}
              max={MAX_PAGE_SIZE}
              step={10}
              className="w-24 h-8"
              value={pageSize}
              onChange={(e) => setPageSize(e.target.value === '' ? '' : parseInt(e.target.value, 10))}
            />
            <Button size="sm" onClick={save} loading={saving}>Save</Button>
            {saved && <span className="text-xs text-green-600">Saved</span>}
          </div>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
        <p className="text-xs text-muted-foreground">Default: {DEFAULT_LIST_PAGE_SIZE} rows.</p>
      </div>
    </div>
  )
}
