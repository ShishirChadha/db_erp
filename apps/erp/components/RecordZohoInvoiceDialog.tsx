'use client'

import { useState, useEffect } from 'react'
import { Loader2, Upload } from 'lucide-react'
import { apiFetch } from '@/lib/api-client'
import { useAsyncAction } from '@/lib/useAsyncAction'
import { useBodyScrollLock } from '@/lib/useBodyScrollLock'
import { createClient } from '@/lib/supabase/client'
import { stateCodeFromPincode } from '@/lib/pincode-state'
import { STATE_CODE_TO_NAME } from '@db/shared'

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
  useBodyScrollLock(true)
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10))
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState('')
  const [placeOfSupply, setPlaceOfSupply] = useState('')
  const [placeOfSupplySource, setPlaceOfSupplySource] = useState('')

  // Prefilled from whatever the customer record already knows -- GSTIN state
  // (most reliable, B2B) -> state_code on file -> a best-effort guess from
  // their pincode -> left blank (falls back to the entity's own state,
  // i.e. a counter/walk-in sale, same as before this field existed). Always
  // editable: none of these beat a human who actually knows this invoice.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const saleRes = await apiFetch(`/api/sales/${saleIds[0]}`)
        if (!saleRes.ok) return
        const sale = await saleRes.json()
        if (!sale?.customer_id) return
        const supabase = createClient()
        const { data: customer } = await supabase
          .from('customers')
          .select('gst_number, state_code, pincode')
          .eq('id', sale.customer_id)
          .single()
        if (cancelled || !customer) return
        const gstState = customer.gst_number?.trim().slice(0, 2) || null
        const pinState = !gstState && !customer.state_code ? stateCodeFromPincode(customer.pincode) : null
        const code = gstState || customer.state_code || pinState || ''
        setPlaceOfSupply(code)
        setPlaceOfSupplySource(gstState ? 'their GSTIN' : customer.state_code ? 'their state on file' : pinState ? 'their pincode' : '')
      } catch {
        // Prefill is a convenience, not a requirement -- leave the field blank on failure.
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
      body: JSON.stringify({
        sale_ids: saleIds, invoice_number: invoiceNumber.trim(), invoice_date: invoiceDate, attachment_urls,
        place_of_supply: placeOfSupply.trim(),
      }),
    })
    if (!res.ok) {
      setErr((await res.json().catch(() => ({}))).error || 'Failed to record invoice.')
      return
    }
    const data = await res.json().catch(() => ({}))
    // This invoice number already existed for the same customer/entity -- these
    // sale(s) were added to it as extra line items rather than creating a new one
    // (see the append path in /api/sales/record-external-invoice).
    if (data.appended) {
      alert(`Added to existing invoice ${data.invoice_number} as ${saleIds.length > 1 ? 'additional line items' : 'an additional line item'}, alongside whatever was already recorded on it.`)
    }
    onRecorded()
    onClose()
  })

  const busy = saving || uploading

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-card p-6 rounded shadow-lg max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto space-y-3">
        <h2 className="text-lg font-bold">Record Zoho Invoice #</h2>
        <p className="text-sm text-muted-foreground">
          Enter the invoice number Zoho already issued{saleIds.length > 1 ? ` for these ${saleIds.length} sales` : ''}. The ERP records it as-is and marks the sale
          {saleIds.length > 1 ? 's' : ''} done — it does not generate a new number.
        </p>
        {err && <div className="text-destructive text-sm">{err}</div>}
        <div>
          <label className="block text-xs font-medium mb-1">Zoho Invoice Number *</label>
          <input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder="e.g. DBI2026/27-00695" className="border p-2 w-full rounded" autoFocus />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">Invoice Date</label>
          <input type="date" value={invoiceDate} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setInvoiceDate(e.target.value)} className="border p-2 w-full rounded" />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">Place of Supply (2-digit state code)</label>
          <input
            value={placeOfSupply}
            onChange={(e) => { setPlaceOfSupply(e.target.value.replace(/\D/g, '').slice(0, 2)); setPlaceOfSupplySource('') }}
            placeholder="Defaults to your own state if left blank"
            className="border p-2 w-full rounded"
            maxLength={2}
          />
          <p className="text-xs text-muted-foreground mt-1">
            {placeOfSupply && STATE_CODE_TO_NAME[placeOfSupply]
              ? `${STATE_CODE_TO_NAME[placeOfSupply]}${placeOfSupplySource ? ` -- guessed from ${placeOfSupplySource}, change it if this invoice went somewhere else` : ''}`
              : 'Where the goods were actually delivered -- a walk-in counter sale is your own state, even if the customer lives elsewhere.'}
          </p>
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">Zoho PDF (optional)</label>
          <label className="text-xs text-muted-foreground flex items-center gap-1 cursor-pointer border rounded px-2 py-1 hover:bg-muted w-fit">
            <Upload className="h-3 w-3" />
            {file ? file.name : 'Attach PDF'}
            <input type="file" className="hidden" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </label>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} disabled={busy} className="px-4 py-2 border rounded text-sm">Cancel</button>
          <button onClick={() => save()} disabled={busy} className="px-4 py-2 bg-primary text-primary-foreground rounded text-sm inline-flex items-center gap-1.5 disabled:opacity-50">
            {busy && <Loader2 className="size-4 animate-spin" />}
            {uploading ? 'Uploading…' : saving ? 'Recording…' : 'Record'}
          </button>
        </div>
      </div>
    </div>
  )
}
