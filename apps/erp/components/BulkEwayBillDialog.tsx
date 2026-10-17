'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { apiFetch } from '@/lib/api-client'
import { useAsyncAction } from '@/lib/useAsyncAction'
import { useBodyScrollLock } from '@/lib/useBodyScrollLock'

// Applies the same E-way Bill number/date to several selected sales at once --
// several sales filed under one invoice physically travel on one E-way Bill, so
// this saves editing EwayBillField row-by-row. Mirrors RecordZohoInvoiceDialog's
// shape (one dialog driving a bulk POST over sale_ids), but independent of
// finalized/invoice_mode -- see /api/sales/bulk-eway-bill.
export function BulkEwayBillDialog({
  saleIds,
  onClose,
  onUpdated,
}: {
  saleIds: string[]
  onClose: () => void
  onUpdated: () => void
}) {
  useBodyScrollLock(true)
  const [number, setNumber] = useState('')
  const [date, setDate] = useState('')
  const [err, setErr] = useState('')

  const { run: save, pending: saving } = useAsyncAction(async () => {
    setErr('')
    if (!number.trim() && !date) { setErr('Enter an E-way Bill number or date.'); return }
    const res = await apiFetch('/api/sales/bulk-eway-bill', {
      method: 'POST',
      body: JSON.stringify({ sale_ids: saleIds, eway_bill_number: number.trim() || null, eway_bill_date: date || null }),
    })
    if (!res.ok) {
      setErr((await res.json().catch(() => ({}))).error || 'Failed to update.')
      return
    }
    onUpdated()
    onClose()
  })

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-card p-6 rounded shadow-lg max-w-sm w-full mx-4 space-y-3">
        <h2 className="text-lg font-bold">Update E-way Bill</h2>
        <p className="text-sm text-muted-foreground">
          Applies the same E-way Bill number/date to all {saleIds.length} selected sales -- useful when several items shipped under one invoice.
        </p>
        {err && <div className="text-destructive text-sm">{err}</div>}
        <div>
          <label className="block text-xs font-medium mb-1">E-way Bill Number</label>
          <input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="e.g. 321001234567" className="border p-2 w-full rounded" autoFocus />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">E-way Bill Date</label>
          <input type="date" value={date} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setDate(e.target.value)} className="border p-2 w-full rounded" />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} disabled={saving} className="px-4 py-2 border rounded text-sm">Cancel</button>
          <button onClick={() => save()} disabled={saving} className="px-4 py-2 bg-primary text-primary-foreground rounded text-sm inline-flex items-center gap-1.5 disabled:opacity-50">
            {saving && <Loader2 className="size-4 animate-spin" />}
            {saving ? 'Saving…' : 'Update'}
          </button>
        </div>
      </div>
    </div>
  )
}
