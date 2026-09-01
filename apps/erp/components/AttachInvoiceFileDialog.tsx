'use client'

import { useState, useEffect } from 'react'
import { Loader2, Upload, Eye } from 'lucide-react'
import { apiFetch } from '@/lib/api-client'
import { useAsyncAction } from '@/lib/useAsyncAction'

// Fills the gap left when a Zoho invoice number was recorded (RecordZohoInvoiceDialog)
// without its PDF at the time -- lets an owner come back and attach one (or another)
// file to that same already-created invoice later, via the new
// /api/invoices/[id]/attachments route.
export function AttachInvoiceFileDialog({
  invoiceId,
  invoiceNumber,
  onClose,
  onAttached,
}: {
  invoiceId: string
  invoiceNumber: string | null
  onClose: () => void
  onAttached: () => void
}) {
  const [attachmentUrls, setAttachmentUrls] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    apiFetch(`/api/invoices/${invoiceId}/attachments`).then(async (res) => {
      if (res.ok) setAttachmentUrls((await res.json()).attachment_urls || [])
      setLoading(false)
    })
  }, [invoiceId])

  const viewFile = async (key: string) => {
    const res = await apiFetch('/api/storage/download-url', {
      method: 'POST',
      body: JSON.stringify({ key, expiresIn: 300 }),
    })
    if (!res.ok) { alert('Failed to open file.'); return }
    const { url } = await res.json()
    window.open(url, '_blank')
  }

  const { run: save, pending: saving } = useAsyncAction(async () => {
    setErr('')
    if (!file) { setErr('Choose a file to attach.'); return }
    setUploading(true)
    let key: string
    try {
      const res = await apiFetch('/api/storage/upload-url', {
        method: 'POST',
        body: JSON.stringify({ fileName: file.name, contentType: file.type, folder: 'zoho-invoices', fileType: 'invoice' }),
      })
      const uploadData = await res.json()
      key = uploadData.key
      await fetch(uploadData.uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } })
    } catch {
      setUploading(false)
      setErr('File upload failed. Try again.')
      return
    }
    setUploading(false)

    const res2 = await apiFetch(`/api/invoices/${invoiceId}/attachments`, {
      method: 'POST',
      body: JSON.stringify({ attachment_urls: [key] }),
    })
    if (!res2.ok) {
      setErr((await res2.json().catch(() => ({}))).error || 'Failed to attach file.')
      return
    }
    setAttachmentUrls((await res2.json()).attachment_urls || [])
    setFile(null)
    onAttached()
  })

  const busy = saving || uploading

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-card p-6 rounded shadow-lg max-w-md w-full space-y-3">
        <h2 className="text-lg font-bold">Invoice File{invoiceNumber ? ` — ${invoiceNumber}` : ''}</h2>

        {loading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : attachmentUrls.length > 0 ? (
          <ul className="text-sm border rounded divide-y">
            {attachmentUrls.map((key, i) => (
              <li key={key} className="p-2 flex items-center justify-between gap-2">
                <span className="truncate">File {i + 1}</span>
                <button onClick={() => viewFile(key)} className="text-primary underline text-xs inline-flex items-center gap-1 shrink-0">
                  <Eye className="h-3 w-3" /> View
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No file attached yet.</p>
        )}

        {err && <div className="text-destructive text-sm">{err}</div>}

        <div>
          <label className="block text-xs font-medium mb-1">{attachmentUrls.length > 0 ? 'Attach another file' : 'Attach invoice PDF'}</label>
          <label className="text-xs text-muted-foreground flex items-center gap-1 cursor-pointer border rounded px-2 py-1 hover:bg-muted w-fit">
            <Upload className="h-3 w-3" />
            {file ? file.name : 'Choose file'}
            <input type="file" className="hidden" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </label>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} disabled={busy} className="px-4 py-2 border rounded text-sm">Close</button>
          <button onClick={() => save()} disabled={busy || !file} className="px-4 py-2 bg-primary text-primary-foreground rounded text-sm inline-flex items-center gap-1.5 disabled:opacity-50">
            {busy && <Loader2 className="size-4 animate-spin" />}
            {uploading ? 'Uploading…' : saving ? 'Attaching…' : 'Attach'}
          </button>
        </div>
      </div>
    </div>
  )
}
