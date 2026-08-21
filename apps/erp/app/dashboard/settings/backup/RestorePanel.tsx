'use client'

import { useRef, useState } from 'react'
import { apiFetch } from '@/lib/api-client'
import { Checkbox } from '@/components/ui/checkbox'
import { SimpleModal } from '@/components/SimpleModal'
import { ErrorBanner } from '@/components/ErrorBanner'

interface ChangedField {
  field: string
  oldValue: unknown
  newValue: unknown
}
interface TableDiff {
  toInsert: { id: string; label: string }[]
  toUpdate: { id: string; label: string; changedFields: ChangedField[] }[]
  unchangedCount: number
  dbOnlyCount: number
}

const TABLE_LABELS: Record<string, string> = {
  sales: 'Sales', sale_payments: 'Sale Payments', purchase_orders: 'Purchase Orders',
  purchase_order_items: 'Purchase Order Items', purchases: 'Purchases (legacy)',
  sku_master: 'SKU Master', asset_ledger: 'Asset Ledger', stock_movements: 'Stock Movements',
  repair_jobs: 'Repair Jobs', customers: 'Customers', vendors: 'Vendors',
  invoices: 'Invoices', invoice_items: 'Invoice Items',
  sales_documents: 'Sales Documents', sales_document_items: 'Sales Document Items',
}

function fmtValue(v: unknown): string {
  if (v === null || v === undefined) return '(empty)'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

export default function RestorePanel({ onApplied }: { onApplied: () => void }) {
  const [payload, setPayload] = useState<Record<string, any[]> | null>(null)
  const [diff, setDiff] = useState<Record<string, TableDiff> | null>(null)
  const [selection, setSelection] = useState<Record<string, Set<string>>>({})
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [applying, setApplying] = useState(false)
  const [result, setResult] = useState<Record<string, any> | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const reset = () => {
    setPayload(null)
    setDiff(null)
    setSelection({})
    setExpandedRows(new Set())
    setResult(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleFile = async (file: File) => {
    setError(null)
    setResult(null)
    setLoading(true)
    try {
      const text = await file.text()
      const parsed = JSON.parse(text)
      const res = await apiFetch('/api/backup/restore/preview', { method: 'POST', body: JSON.stringify({ payload: parsed }) })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setError(err.error || 'Failed to compute the restore preview.')
        return
      }
      const { tables } = await res.json()
      setPayload(parsed)
      setDiff(tables)
      const initialSelection: Record<string, Set<string>> = {}
      for (const table of Object.keys(tables)) {
        const d: TableDiff = tables[table]
        initialSelection[table] = new Set([...d.toInsert.map((r) => r.id), ...d.toUpdate.map((r) => r.id)])
      }
      setSelection(initialSelection)
    } catch {
      setError('That file is not valid backup JSON.')
    } finally {
      setLoading(false)
    }
  }

  const toggleRow = (table: string, id: string, checked: boolean) => {
    setSelection((prev) => {
      const next = new Set(prev[table])
      if (checked) next.add(id)
      else next.delete(id)
      return { ...prev, [table]: next }
    })
  }

  const toggleAllInTable = (table: string, ids: string[], checked: boolean) => {
    setSelection((prev) => ({ ...prev, [table]: checked ? new Set(ids) : new Set() }))
  }

  const toggleExpanded = (key: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const selectedCounts = diff
    ? Object.entries(selection).reduce((acc, [table, ids]) => acc + ids.size, 0)
    : 0

  const handleApply = async () => {
    if (!payload) return
    setApplying(true)
    try {
      const selected: Record<string, string[]> = {}
      for (const [table, ids] of Object.entries(selection)) {
        if (ids.size > 0) selected[table] = Array.from(ids)
      }
      const res = await apiFetch('/api/backup/restore/apply', { method: 'POST', body: JSON.stringify({ payload, selected }) })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setError(err.error || 'Restore failed.')
        setConfirmOpen(false)
        return
      }
      const summary = await res.json()
      setResult(summary)
      setConfirmOpen(false)
      setDiff(null)
      onApplied()
    } finally {
      setApplying(false)
    }
  }

  return (
    <div className="max-w-3xl flex flex-col gap-4">
      <p className="text-sm text-gray-600">
        Upload a previously downloaded backup file to see what's changed compared to the live database, then choose what to restore.
        Restore only inserts new records and updates existing ones — it never deletes anything.
      </p>

      <input
        ref={fileInputRef}
        type="file"
        accept="application/json"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) handleFile(file)
        }}
        className="text-sm"
      />

      {error && <ErrorBanner message={error} />}
      {loading && <p className="text-sm text-gray-400">Comparing against the live database…</p>}

      {result && (
        <div className="rounded-md bg-green-50 border border-green-200 text-green-800 text-sm p-3">
          Restore applied. A safety snapshot of the full database was saved to history first (id: {result.safetySnapshotId?.slice(0, 8)}).
          <button onClick={reset} className="ml-2 underline">Restore another file</button>
        </div>
      )}

      {diff && (
        <div className="flex flex-col gap-4">
          {Object.entries(diff).map(([table, d]) => {
            const hasChanges = d.toInsert.length > 0 || d.toUpdate.length > 0
            if (!hasChanges && d.unchangedCount === 0 && d.dbOnlyCount === 0) return null
            const allIds = [...d.toInsert.map((r) => r.id), ...d.toUpdate.map((r) => r.id)]
            const selectedInTable = selection[table]?.size ?? 0
            return (
              <div key={table} className="border rounded-md p-3">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-medium">{TABLE_LABELS[table] || table}</h3>
                  {allIds.length > 0 && (
                    <label className="flex items-center gap-2 text-xs text-gray-600">
                      <Checkbox
                        checked={selectedInTable === allIds.length}
                        onCheckedChange={(v) => toggleAllInTable(table, allIds, !!v)}
                      />
                      Select all ({selectedInTable}/{allIds.length})
                    </label>
                  )}
                </div>

                {d.toInsert.length === 0 && d.toUpdate.length === 0 && (
                  <p className="text-sm text-gray-400">No new or changed records.</p>
                )}

                {d.toInsert.map((row) => (
                  <label key={row.id} className="flex items-center gap-2 text-sm py-1">
                    <Checkbox checked={selection[table]?.has(row.id) ?? false} onCheckedChange={(v) => toggleRow(table, row.id, !!v)} />
                    <span className="rounded bg-green-100 text-green-700 text-xs px-1.5 py-0.5">new</span>
                    {row.label}
                  </label>
                ))}

                {d.toUpdate.map((row) => {
                  const rowKey = `${table}:${row.id}`
                  const isExpanded = expandedRows.has(rowKey)
                  return (
                    <div key={row.id} className="py-1">
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox checked={selection[table]?.has(row.id) ?? false} onCheckedChange={(v) => toggleRow(table, row.id, !!v)} />
                        <span className="rounded bg-amber-100 text-amber-700 text-xs px-1.5 py-0.5">changed</span>
                        {row.label}
                        <button type="button" onClick={() => toggleExpanded(rowKey)} className="text-xs text-blue-600 hover:underline ml-1">
                          {isExpanded ? 'hide' : `${row.changedFields.length} field(s)`}
                        </button>
                      </label>
                      {isExpanded && (
                        <div className="ml-7 mt-1 text-xs text-gray-600 flex flex-col gap-0.5">
                          {row.changedFields.map((f) => (
                            <div key={f.field}>
                              <span className="font-mono">{f.field}</span>: {fmtValue(f.oldValue)} → {fmtValue(f.newValue)}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}

                <p className="text-xs text-gray-400 mt-2">
                  {d.unchangedCount} unchanged, {d.dbOnlyCount} only in the live database (left untouched).
                </p>
              </div>
            )
          })}

          <button
            onClick={() => setConfirmOpen(true)}
            disabled={selectedCounts === 0}
            className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50 w-fit"
          >
            Review & Apply ({selectedCounts} selected)
          </button>
        </div>
      )}

      <SimpleModal isOpen={confirmOpen} onClose={() => setConfirmOpen(false)} title="Confirm restore">
        <div className="flex flex-col gap-3 text-sm">
          <p>This will apply {selectedCounts} record{selectedCounts === 1 ? '' : 's'} across {Object.values(selection).filter((s) => s.size > 0).length} table(s):</p>
          <ul className="list-disc pl-5">
            {Object.entries(selection).filter(([, ids]) => ids.size > 0).map(([table, ids]) => (
              <li key={table}>{TABLE_LABELS[table] || table}: {ids.size}</li>
            ))}
          </ul>
          <p className="text-gray-600">A full safety snapshot of the current database will be taken first, so this can be undone by restoring it again.</p>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setConfirmOpen(false)} className="bg-gray-200 px-4 py-2 rounded">Cancel</button>
            <button onClick={handleApply} disabled={applying} className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50">
              {applying ? 'Applying…' : 'Confirm & Apply'}
            </button>
          </div>
        </div>
      </SimpleModal>
    </div>
  )
}
