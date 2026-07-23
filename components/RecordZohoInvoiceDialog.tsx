'use client'

import { useState } from 'react'
import { Loader2, Upload } from 'lucide-react'
import { apiFetch } from '@/lib/api-client'
import { useAsyncAction } from '@/lib/useAsyncAction'

// Records a Zoho (external) invoice number against one or more sales during the
// transition -- the ERP stores the real number verbatim and never mints its own.
// Used for a single sale (saleIds = [id]) and a combined Zoho invoice over several
// sales (saleIds = [id, id, ...]).
export function RecordZohoInvoiceDialog({
  saleIds,
  onClose,
  onRecorded,
}: {
  saleIds: string[]
  onClose: () => void
  onRecorded: () => void
}) {
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10))
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState('')

  const uploadPdf = async (): Promise<string[]> => {
    if (!file) return []
    setUploading(true)
    try {
      const res = await apiFetch('/api/storage/upload-url', {
        method: 'POST',
        body: JSON.stringify({ fileName: file.name, contentType: file.type, folder: 'zoho-invoices', fileType: 'invoice' }),
      })
      const { uploadUrl, key } = await res.json()
      await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } })
      return [key]
    } finally {
      setUploading(false)
    }
  }

  const { run: save, pending: saving } = useAsyncAction(async () => {
    setErr('')
    if (!invoiceNumber.trim()) { setErr('Enter the Zoho invoice number.'); return }
    let attachment_urls: string[] = []
    try {
      attachment_urls = await uploadPdf()
    } catch {
      setErr('PDF upload failed. Try again, or record without the PDF.')
      return
    }
    const res = await apiFetch('/api/sales/record-external-invoice', {
      method: 'POST',
      body: JSON.stringify({ sale_ids: saleIds, invoice_number: invoiceNumber.trim(), invoice_date: invoiceDate, attachment_urls }),
    })
    if (!res.ok) {
      setErr((await res.json().catch(() => ({}))).error || 'Failed to record invoice.')
      return
    }
    onRecorded()
    onClose()
  })

  const busy = saving || uploading

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white p-6 rounded shadow-lg max-w-md w-full space-y-3">
        <h2 className="text-lg font-bold">Record Zoho Invoice #</h2>
        <p className="text-sm text-gray-500">
          Enter the invoice number Zoho already issued{saleIds.length > 1 ? ` for these ${saleIds.length} sales` : ''}. The ERP records it as-is and marks the sale
          {saleIds.length > 1 ? 's' : ''} done — it does not generate a new number.
        </p>
        {err && <div className="text-red-600 text-sm">{err}</div>}
        <div>
          <label className="block text-xs font-medium mb-1">Zoho Invoice Number *</label>
          <input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder="e.g. DBI2026/27-00695" className="border p-2 w-full rounded" autoFocus />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">Invoice Date</label>
          <input type="date" value={invoiceDate} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setInvoiceDate(e.target.value)} className="border p-2 w-full rounded" />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">Zoho PDF (optional)</label>
          <label className="text-xs text-gray-600 flex items-center gap-1 cursor-pointer border rounded px-2 py-1 hover:bg-gray-50 w-fit">
            <Upload className="h-3 w-3" />
            {file ? file.name : 'Attach PDF'}
            <input type="file" className="hidden" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </label>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} disabled={busy} className="px-4 py-2 border rounded text-sm">Cancel</button>
          <button onClick={() => save()} disabled={busy} className="px-4 py-2 bg-blue-600 text-white rounded text-sm inline-flex items-center gap-1.5 disabled:opacity-50">
            {busy && <Loader2 className="size-4 animate-spin" />}
            {uploading ? 'Uploading…' : saving ? 'Recording…' : 'Record'}
          </button>
        </div>
      </div>
    </div>
  )
}
