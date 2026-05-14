'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { apiFetch } from '@/lib/api-client'

interface PO {
  po_number: string
  po_date: string
  vendor_name: string
  purchased_by_type: string
  po_status: string
}

interface AssetItem {
  asset_number: string
  serial_number: string | null
  status: string
}

interface POItem {
  id: string
  line_item_number: number
  sku_id: string
  sku_code: string
  sku_desc: string
  quantity: number
  unit_price: number
  gst_percentage: number
  line_total: number
  assets: AssetItem[]
}

interface Invoice {
  id: string
  invoice_number: string
  invoice_date: string
  po_id: string | null
  total_amount: number | null
  gst_total: number | null
  grand_total: number | null
  payment_status: string
  notes: string | null
  attachment_urls: string[] | null
  purchase_order: PO | null
  po_items: POItem[]
}

export default function InvoiceDetailPage() {
  const params = useParams()
  const router = useRouter()
  const invoiceId = params.id as string

  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchInvoice = async () => {
      try {
        const res = await apiFetch(`/api/purchase-invoices/${invoiceId}`)
        if (!res.ok) {
          const errText = await res.text()
          throw new Error(errText || 'Invoice not found')
        }
        const data = await res.json()
        setInvoice(data)
      } catch (err: any) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }
    fetchInvoice()
  }, [invoiceId])

  if (loading) return <div className="p-4">Loading invoice…</div>
  if (error) return <div className="p-4 text-red-600">Error: {error}</div>
  if (!invoice) return <div className="p-4 text-red-600">Invoice not found.</div>

  return (
    <div className="p-4 max-w-4xl mx-auto">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">{invoice.invoice_number}</h1>
        <span className="px-2 py-1 rounded bg-gray-100 text-gray-700 capitalize">
          {invoice.payment_status}
        </span>
      </div>

      <div className="bg-white p-4 shadow rounded mb-6 grid grid-cols-2 gap-4">
        <div>
          <p><strong>Invoice Date:</strong> {invoice.invoice_date}</p>
          <p><strong>Total Amount:</strong> ₹{invoice.total_amount?.toFixed(2)}</p>
          <p><strong>GST:</strong> ₹{invoice.gst_total?.toFixed(2)}</p>
          <p><strong>Grand Total:</strong> ₹{invoice.grand_total?.toFixed(2)}</p>
        </div>
        <div>
          {invoice.purchase_order && (
            <>
              <p><strong>PO Number:</strong> {invoice.purchase_order.po_number}</p>
              <p><strong>PO Date:</strong> {invoice.purchase_order.po_date}</p>
              <p><strong>Vendor:</strong> {invoice.purchase_order.vendor_name}</p>
              <p><strong>Purchased By:</strong> {invoice.purchase_order.purchased_by_type}</p>
              <p><strong>PO Status:</strong> {(invoice.purchase_order.po_status || '').replace('_', ' ')}</p>
            </>
          )}
        </div>
      </div>

      {invoice.po_items.length > 0 && (
        <div className="mb-6">
          <h2 className="text-lg font-semibold mb-2">Purchased Items</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full border">
              <thead>
                <tr>
                  <th className="border p-2">Item #</th>
                  <th className="border p-2">SKU</th>
                  <th className="border p-2">Description</th>
                  <th className="border p-2">Qty</th>
                  <th className="border p-2">Unit Price</th>
                  <th className="border p-2">GST</th>
                  <th className="border p-2">Line Total</th>
                  <th className="border p-2">Asset Numbers (Serial)</th>
                </tr>
              </thead>
              <tbody>
                {invoice.po_items.map((item) => (
                  <tr key={item.id}>
                    <td className="border p-2">{item.line_item_number}</td>
                    <td className="border p-2">{item.sku_code}</td>
                    <td className="border p-2">{item.sku_desc}</td>
                    <td className="border p-2">{item.quantity}</td>
                    <td className="border p-2">₹{item.unit_price.toFixed(2)}</td>
                    <td className="border p-2">{item.gst_percentage}%</td>
                    <td className="border p-2">₹{item.line_total.toFixed(2)}</td>
                    <td className="border p-2 text-sm">
                      {item.assets.length > 0 ? (
                        <div>
                          {item.assets.map((asset, i) => (
                            <div key={i}>
                              <strong>{asset.asset_number}</strong>
                              {asset.serial_number ? ` (${asset.serial_number})` : ''}
                              <span className="ml-1 text-gray-400">[{asset.status}]</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {invoice.notes && (
        <div className="mb-4">
          <h3 className="font-semibold mb-1">Notes</h3>
          <p className="text-gray-700">{invoice.notes}</p>
        </div>
      )}
      {invoice.attachment_urls && invoice.attachment_urls.length > 0 && (
        <div className="mb-4">
          <h3 className="font-semibold mb-1">Attachments</h3>
          {invoice.attachment_urls.map((url, idx) => (
            <a key={idx} href={url} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline block">
              View Attachment {idx + 1}
            </a>
          ))}
        </div>
      )}

      <div className="mt-4 flex gap-2">
        <button
          onClick={async () => {
            if (!confirm('Permanently delete this invoice? This cannot be undone.')) return
            const res = await apiFetch(`/api/purchase-invoices/${invoiceId}`, { method: 'DELETE' })
            if (res.ok) {
              alert('Invoice deleted.')
              router.push('/dashboard/purchase-invoices')
            } else {
              const err = await res.json().catch(() => ({}))
              alert(err.error || 'Failed to delete invoice')
            }
          }}
          className="bg-red-600 text-white px-4 py-2 rounded"
        >
          Delete Invoice
        </button>
        <button onClick={() => router.back()} className="bg-gray-200 px-4 py-2 rounded">Back</button>
      </div>
    </div>
  )
}