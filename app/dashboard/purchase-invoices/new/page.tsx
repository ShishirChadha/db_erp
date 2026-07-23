'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { apiFetch } from '@/lib/api-client'
import RequireOwner from '@/components/RequireOwner'
import { useAsyncAction } from '@/lib/useAsyncAction'

interface PO {
  id: string
  po_number: string
  vendor_name: string
  grand_total: number
  gst_total: number
  total_amount: number
}

function NewPurchaseInvoicePage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const preselectedPoId = searchParams.get('po_id') || ''

  const [poId, setPoId] = useState(preselectedPoId)
  const [pos, setPos] = useState<PO[]>([])
  const [loadingPOs, setLoadingPOs] = useState(true)
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10))
  const [totalAmount, setTotalAmount] = useState('')
  const [gstTotal, setGstTotal] = useState('')
  const [grandTotal, setGrandTotal] = useState('')
  const [paymentStatus, setPaymentStatus] = useState('pending')
  const [notes, setNotes] = useState('')
  const [attachment, setAttachment] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Fetch POs that can be invoiced (any active PO – you can adjust filters later)
  const fetchPOs = useCallback(async () => {
    try {
      setLoadingPOs(true)
      // Fetch all non-draft POs (exclude draft & cancelled)
      const res = await apiFetch('/api/purchase-orders?status=submitted,partially_received,received,invoiced')
      if (!res.ok) throw new Error('Failed to load POs')
      const data = await res.json()
      setPos(Array.isArray(data) ? data : [])
    } catch (err: any) {
      console.error(err)
      setError(err.message)
    } finally {
      setLoadingPOs(false)
    }
  }, [])

  useEffect(() => {
    fetchPOs()
  }, [fetchPOs])

  // If a preselected PO is not in the list (e.g., it's already invoiced), fetch it directly
  useEffect(() => {
    if (preselectedPoId && !pos.find(p => p.id === preselectedPoId)) {
      apiFetch(`/api/purchase-orders/${preselectedPoId}`)
        .then(res => (res.ok ? res.json() : null))
        .then(data => {
          if (data) setPos(prev => [data, ...prev])
        })
    }
  }, [preselectedPoId, pos])

  // Auto‑fill totals when a PO is selected
  useEffect(() => {
    if (!poId) return
    const selected = pos.find(p => p.id === poId)
    if (selected) {
      setTotalAmount(selected.total_amount?.toString() || '')
      setGstTotal(selected.gst_total?.toString() || '')
      setGrandTotal(selected.grand_total?.toString() || '')
    }
  }, [poId, pos])

  // Upload file helper — signed-URL flow (private bucket), same mechanism as
  // components/FileUpload.tsx, instead of the old base64-through-server/public-bucket
  // route. Returns the storage key (not a public URL); viewing it later requires a
  // signed download URL (see app/dashboard/purchase-invoices/[id]/page.tsx).
  const handleUpload = async () => {
    if (!attachment) return null
    setUploading(true)

    try {
      const selectedPO = pos.find(p => p.id === poId)
      const folder = `purchase-invoices/${selectedPO?.po_number || 'unassigned'}`

      const urlRes = await apiFetch('/api/storage/upload-url', {
        method: 'POST',
        body: JSON.stringify({
          fileName: attachment.name,
          contentType: attachment.type,
          folder,
          fileType: 'invoice',
        }),
      })
      if (!urlRes.ok) {
        alert('Upload failed')
        return null
      }
      const { uploadUrl, key } = await urlRes.json()

      const putRes = await fetch(uploadUrl, {
        method: 'PUT',
        body: attachment,
        headers: { 'Content-Type': attachment.type },
      })
      if (!putRes.ok) {
        alert('Upload failed')
        return null
      }

      return key
    } catch (err) {
      alert('Upload failed')
      return null
    } finally {
      setUploading(false)
    }
  }

  const { run: handleSubmit, pending: submitting } = useAsyncAction(async (e: React.FormEvent) => {
    e.preventDefault()
    const attachmentUrl = await handleUpload()

    const res = await apiFetch('/api/purchase-invoices', {
      method: 'POST',
      body: JSON.stringify({
        po_id: poId,
        invoice_number: invoiceNumber,
        invoice_date: invoiceDate,
        total_amount: Number(totalAmount),
        gst_total: Number(gstTotal),
        grand_total: Number(grandTotal),
        payment_status: paymentStatus,
        notes,
        attachment_urls: attachmentUrl ? [attachmentUrl] : [],
      }),
    })

    if (res.ok) {
      const data = await res.json()
      router.push(`/dashboard/purchase-invoices/${data.id}`)
    } else {
      const err = await res.json().catch(() => ({}))
      alert(err.error || 'Failed to create invoice')
    }
  })

  if (error) return <div className="p-4 text-red-600">Error: {error}</div>

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">New Purchase Invoice</h1>
      <form onSubmit={handleSubmit}>
        {/* PO Selection */}
        <div className="mb-3">
          <label className="block font-medium">Purchase Order</label>
          {loadingPOs ? (
            <p className="text-sm text-gray-500">Loading POs...</p>
          ) : (
            <select
              value={poId}
              onChange={(e) => setPoId(e.target.value)}
              className="border p-2 w-full rounded"
              required
            >
              <option value="">Select a PO...</option>
              {pos.map(po => (
                <option key={po.id} value={po.id}>
                  {po.po_number} — {po.vendor_name}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Invoice details */}
        <div className="mb-3">
          <label className="block font-medium">Invoice Number</label>
          <input
            type="text"
            value={invoiceNumber}
            onChange={(e) => setInvoiceNumber(e.target.value)}
            className="border p-2 w-full rounded"
            required
          />
        </div>

        <div className="mb-3">
          <label className="block font-medium">Invoice Date</label>
          <input
            type="date"
            value={invoiceDate}
            onChange={(e) => setInvoiceDate(e.target.value)}
            className="border p-2 w-full rounded"
            required
          />
        </div>

        {/* Totals (auto‑filled from PO, but editable) */}
        <div className="grid grid-cols-3 gap-4 mb-3">
          <div>
            <label className="block font-medium">Total Amount</label>
            <input
              type="number"
              value={totalAmount}
              onChange={(e) => setTotalAmount(e.target.value)}
              className="border p-2 w-full rounded"
              required
            />
          </div>
          <div>
            <label className="block font-medium">GST Total</label>
            <input
              type="number"
              value={gstTotal}
              onChange={(e) => setGstTotal(e.target.value)}
              className="border p-2 w-full rounded"
              required
            />
          </div>
          <div>
            <label className="block font-medium">Grand Total</label>
            <input
              type="number"
              value={grandTotal}
              onChange={(e) => setGrandTotal(e.target.value)}
              className="border p-2 w-full rounded"
              required
            />
          </div>
        </div>

        {/* Payment status */}
        <div className="mb-3">
          <label className="block font-medium">Payment Status</label>
          <select
            value={paymentStatus}
            onChange={(e) => setPaymentStatus(e.target.value)}
            className="border p-2 w-full rounded"
          >
            <option value="pending">Pending</option>
            <option value="paid">Paid</option>
            <option value="partial">Partial</option>
          </select>
        </div>

        <div className="mb-3">
          <label className="block font-medium">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="border p-2 w-full rounded"
          />
        </div>

        <div className="mb-3">
          <label className="block font-medium">Attachment (PDF/Image)</label>
          <input
            type="file"
            onChange={(e) => setAttachment(e.target.files?.[0] || null)}
            className="border p-2 w-full rounded"
          />
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <button type="button" onClick={() => router.back()} disabled={submitting} className="px-4 py-2 border rounded disabled:opacity-50">
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {submitting && <Loader2 className="size-4 animate-spin" />}
            {uploading ? 'Uploading...' : submitting ? 'Saving...' : 'Create Invoice'}
          </button>
        </div>
      </form>
    </div>
  )
}

export default function NewPurchaseInvoicePageGuarded() {
  return (
    <RequireOwner>
      <NewPurchaseInvoicePage />
    </RequireOwner>
  )
}