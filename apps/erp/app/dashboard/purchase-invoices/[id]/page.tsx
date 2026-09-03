'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { apiFetch } from '@/lib/api-client'
import RequireOwner from '@/components/RequireOwner'
import { useAsyncAction } from '@/lib/useAsyncAction'
import { AddVendorPaymentDialog } from '@/components/AddVendorPaymentDialog'

interface PO {
  id: string
  po_number: string
  po_date: string
  vendor_name: string
  purchased_by_type: string
  po_status: string
  amount_paid: number | null
  payment_status: string | null
  grand_total: number | null
}

interface VendorPayment {
  id: string
  amount: number
  payment_account: string | null
  paid_on: string
  method: string | null
  reference: string | null
  note: string | null
  recorded_by_name: string | null
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

function InvoiceDetailPage() {
  const params = useParams()
  const router = useRouter()
  const invoiceId = params.id as string

  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [payments, setPayments] = useState<VendorPayment[]>([])
  const [showAddPayment, setShowAddPayment] = useState(false)

  const { run: handleDelete, pending: deleting } = useAsyncAction(async () => {
    if (!confirm('Permanently delete this invoice? This cannot be undone.')) return
    const res = await apiFetch(`/api/purchase-invoices/${invoiceId}`, { method: 'DELETE' })
    if (res.ok) {
      alert('Invoice deleted.')
      router.push('/dashboard/purchase-invoices')
    } else {
      const err = await res.json().catch(() => ({}))
      alert(err.error || 'Failed to delete invoice')
    }
  })

  const fetchInvoice = async () => {
    try {
      const res = await apiFetch(`/api/purchase-invoices/${invoiceId}`)
      if (!res.ok) {
        const errText = await res.text()
        throw new Error(errText || 'Invoice not found')
      }
      const data = await res.json()
      setInvoice(data)
      return data as Invoice
    } catch (err: any) {
      setError(err.message)
      return null
    } finally {
      setLoading(false)
    }
  }

  // Vendor payments are recorded once against the PO (see AddVendorPaymentDialog),
  // not per-invoice -- an invoice's "payment date" is that same ledger, filtered by
  // its own po_id.
  const loadPayments = async (poId: string | null) => {
    if (!poId) { setPayments([]); return }
    const res = await apiFetch(`/api/purchase-orders/${poId}/payments`)
    if (res.ok) setPayments(await res.json())
  }

  useEffect(() => {
    fetchInvoice().then((data) => loadPayments(data?.po_id ?? null))
  }, [invoiceId])

  const deletePayment = async (paymentId: string) => {
    if (!invoice?.po_id) return
    if (!confirm('Remove this payment entry?')) return
    const res = await apiFetch(`/api/purchase-orders/${invoice.po_id}/payments/${paymentId}`, { method: 'DELETE' })
    if (res.ok) {
      loadPayments(invoice.po_id)
      fetchInvoice()
    }
  }

  if (loading) return <div className="p-4">Loading invoice…</div>
  if (error) return <div className="p-4 text-destructive">Error: {error}</div>
  if (!invoice) return <div className="p-4 text-destructive">Invoice not found.</div>

  return (
    <div className="p-4 max-w-4xl mx-auto">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">{invoice.invoice_number}</h1>
        <span className="px-2 py-1 rounded bg-muted text-muted-foreground capitalize">
          {invoice.payment_status}
        </span>
      </div>

      <div className="bg-card p-4 shadow rounded mb-6 grid grid-cols-2 gap-4">
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
                              <span className="ml-1 text-muted-foreground">[{asset.status}]</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {invoice.purchase_order && (
        <div className="border rounded p-3 space-y-2 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">Vendor Payment</p>
              <div className="text-sm capitalize">
                {invoice.purchase_order.payment_status} · ₹{(invoice.purchase_order.amount_paid ?? 0).toFixed(2)} of ₹{(invoice.purchase_order.grand_total ?? 0).toFixed(2)}
              </div>
            </div>
            {invoice.purchase_order.payment_status !== 'paid' && (
              <button
                onClick={() => setShowAddPayment(true)}
                className="border rounded px-3 py-1.5 text-sm hover:bg-muted"
              >
                Add Payment
              </button>
            )}
          </div>
          {payments.length > 0 && (
            <ul className="text-xs border-t pt-2 divide-y max-h-32 overflow-y-auto">
              {payments.map((p) => (
                <li key={p.id} className="py-1 flex items-center justify-between gap-2">
                  <div>
                    ₹{p.amount.toFixed(2)}{p.payment_account ? ` · ${p.payment_account}` : ''}{p.method ? ` · ${p.method}` : ''}
                    {p.note ? ` · ${p.note}` : ''}
                    <div className="text-muted-foreground">
                      {new Date(p.paid_on).toLocaleDateString()}{p.recorded_by_name ? ` · ${p.recorded_by_name}` : ''}
                    </div>
                  </div>
                  <button type="button" onClick={() => deletePayment(p.id)} className="text-destructive underline shrink-0">
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {invoice.notes && (
        <div className="mb-4">
          <h3 className="font-semibold mb-1">Notes</h3>
          <p className="text-muted-foreground">{invoice.notes}</p>
        </div>
      )}
      {invoice.attachment_urls && invoice.attachment_urls.length > 0 && (
        <div className="mb-4">
          <h3 className="font-semibold mb-1">Attachments</h3>
          {invoice.attachment_urls.map((key, idx) => (
            <button
              key={idx}
              type="button"
              onClick={async () => {
                const res = await apiFetch('/api/storage/download-url', {
                  method: 'POST',
                  body: JSON.stringify({ key, expiresIn: 300 }),
                })
                if (!res.ok) {
                  alert('Could not open attachment')
                  return
                }
                const { url } = await res.json()
                window.open(url, '_blank')
              }}
              className="text-primary underline block text-left"
            >
              View Attachment {idx + 1}
            </button>
          ))}
        </div>
      )}

      <div className="mt-4 flex gap-2">
        <button
          onClick={() => handleDelete()}
          disabled={deleting}
          className="bg-destructive text-destructive-foreground px-4 py-2 rounded disabled:opacity-50 inline-flex items-center gap-1.5"
        >
          {deleting && <Loader2 className="size-4 animate-spin" />}
          Delete Invoice
        </button>
        <button onClick={() => router.back()} disabled={deleting} className="bg-muted px-4 py-2 rounded disabled:opacity-50">Back</button>
      </div>

      {showAddPayment && invoice.po_id && invoice.purchase_order && (
        <AddVendorPaymentDialog
          poId={invoice.po_id}
          balanceDue={(invoice.purchase_order.grand_total ?? 0) - (invoice.purchase_order.amount_paid ?? 0)}
          onClose={() => setShowAddPayment(false)}
          onSaved={() => { loadPayments(invoice.po_id); fetchInvoice() }}
        />
      )}
    </div>
  )
}

export default function InvoiceDetailPageGuarded() {
  return (
    <RequireOwner>
      <InvoiceDetailPage />
    </RequireOwner>
  )
}