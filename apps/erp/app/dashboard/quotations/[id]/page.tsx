'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, Pencil, Send, CheckCircle2, XCircle, Ban, Eye, FileText, Mail, Printer, User } from 'lucide-react'
import { apiFetch } from '@/lib/api-client'
import RequirePageAccess from '@/components/RequirePageAccess'
import { useAsyncAction } from '@/lib/useAsyncAction'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/StatusBadge'
import { SALES_DOCUMENT_STATUS_TONES, toneFor } from '@/lib/status-styles'
import PdfPreviewDialog from '@/components/PdfPreviewDialog'
import { downloadPdfFromResponse, previewablePdfUrl } from '@/lib/download-pdf'
import { EditSalesDocumentDialog } from '@/components/SalesDocumentForm'

function money(n: number | null | undefined) {
  return `₹${Number(n || 0).toFixed(2)}`
}

function ViewSalesDocumentPage() {
  const { id } = useParams()
  const router = useRouter()
  const [doc, setDoc] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  const fetchDoc = useCallback(async () => {
    const res = await apiFetch(`/api/sales-documents/${id}`)
    if (!res.ok) { router.push('/dashboard/quotations'); return }
    setDoc(await res.json())
    setLoading(false)
  }, [id, router])

  useEffect(() => { fetchDoc() }, [fetchDoc])

  const { run: changeStatus, pending: changingStatus } = useAsyncAction(async (status: string) => {
    await apiFetch(`/api/sales-documents/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) })
    await fetchDoc()
  })

  const { run: downloadPdf, pending: downloading } = useAsyncAction(async () => {
    const res = await apiFetch(`/api/sales-documents/${id}/pdf`)
    if (!res.ok) return
    await downloadPdfFromResponse(res, `${doc.document_number}.pdf`)
  })

  const { run: previewPdf, pending: previewing } = useAsyncAction(async () => {
    const res = await apiFetch(`/api/sales-documents/${id}/pdf`)
    if (!res.ok) return
    setPreviewUrl(await previewablePdfUrl(res, `${doc.document_number}.pdf`))
  })

  const { run: emailDoc, pending: emailing } = useAsyncAction(async () => {
    const to = window.prompt('Send to which email address?', doc.customer_email || '')
    if (!to) return
    const res = await apiFetch(`/api/sales-documents/${id}/email`, { method: 'POST', body: JSON.stringify({ to }) })
    const data = await res.json().catch(() => ({}))
    alert(res.ok ? `Sent to ${data.sent_to}.` : (data.error || 'Failed to send email.'))
  })

  const busy = changingStatus || downloading || previewing || emailing

  const convertLine = (item: any) => {
    const params = new URLSearchParams({
      customer_id: doc.customer_id,
      source_document_item_id: item.id,
      prefill_rate: String(item.rate),
      prefill_gst_rate: String(item.gst_rate || 0),
    })
    if (item.sku_id && item.description) params.set('sku_search', item.description.split(' ')[0])
    window.open(`/dashboard/entry/sell?${params.toString()}`, '_blank')
  }

  if (loading) return <div className="p-6 text-muted-foreground">Loading...</div>
  if (!doc) return <div className="p-6 text-muted-foreground">Document not found</div>

  // A document can only be content-edited (entity/customer/line items) while nothing on
  // it has been converted into a real sale yet -- see the PATCH route's own guard, which
  // is the actual enforcement; this just decides whether to show the button at all.
  const canEditContent = ['draft', 'sent'].includes(doc.status) && !doc.items.some((i: any) => i.converted)
  const docLabel = doc.doc_type === 'quotation' ? 'Quotation' : 'Proforma Invoice'

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* ---------- Toolbar ---------- */}
      <div className="flex flex-wrap justify-between items-center gap-2">
        <Button variant="ghost" onClick={() => router.push('/dashboard/quotations')}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back
        </Button>
        <div className="flex flex-wrap gap-2">
          {canEditContent && (
            <Button variant="outline" onClick={() => setEditing(true)} disabled={busy}>
              <Pencil className="mr-2 h-4 w-4" /> Edit
            </Button>
          )}
          {doc.status === 'draft' && (
            <Button variant="outline" onClick={() => changeStatus('sent')} disabled={busy} loading={changingStatus}>
              <Send className="mr-2 h-4 w-4" /> Mark Sent
            </Button>
          )}
          {['draft', 'sent'].includes(doc.status) && (
            <Button variant="outline" onClick={() => changeStatus('accepted')} disabled={busy} loading={changingStatus}>
              <CheckCircle2 className="mr-2 h-4 w-4 text-success" /> Mark Accepted
            </Button>
          )}
          {['draft', 'sent'].includes(doc.status) && (
            <Button variant="outline" onClick={() => changeStatus('rejected')} disabled={busy} loading={changingStatus}>
              <XCircle className="mr-2 h-4 w-4 text-destructive" /> Mark Rejected
            </Button>
          )}
          {doc.status !== 'void' && (
            <Button variant="outline" onClick={() => changeStatus('void')} disabled={busy} loading={changingStatus}>
              <Ban className="mr-2 h-4 w-4" /> Void
            </Button>
          )}
          <Button variant="outline" onClick={() => previewPdf()} disabled={busy} loading={previewing}>
            <Eye className="mr-2 h-4 w-4" /> Preview
          </Button>
          <Button variant="outline" onClick={() => downloadPdf()} disabled={busy} loading={downloading}>
            <FileText className="mr-2 h-4 w-4" /> Download PDF
          </Button>
          <Button variant="outline" onClick={() => emailDoc()} disabled={busy} loading={emailing}>
            <Mail className="mr-2 h-4 w-4" /> Email
          </Button>
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="mr-2 h-4 w-4" /> Print
          </Button>
        </div>
      </div>

      {/* ---------- Document sheet ---------- */}
      <div className="border rounded-xl bg-card shadow-sm overflow-hidden">
        {/* Header band */}
        <div className="p-5 md:p-6 border-b bg-muted/30">
          <div className="flex flex-wrap justify-between items-start gap-4">
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">{docLabel}</p>
              <h1 className="text-3xl font-bold tabular-nums">#{doc.document_number}</h1>
              <p className="text-sm text-muted-foreground mt-1">
                {doc.document_date}
                {doc.valid_until && ` · Valid until ${doc.valid_until}`}
                {doc.place_of_supply && ` · Place of Supply: ${doc.place_of_supply}`}
              </p>
            </div>
            <StatusBadge tone={toneFor(SALES_DOCUMENT_STATUS_TONES, doc.status)} className="text-sm px-3 py-1">
              {doc.status}
            </StatusBadge>
          </div>
        </div>

        <div className="p-5 md:p-6 space-y-6">
          {/* Customer */}
          <div className="border rounded-lg p-4 max-w-md">
            <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground mb-2">
              <User className="h-4 w-4" /> Customer
            </div>
            <p className="text-base font-medium">{doc.customer_name}</p>
            {doc.customer_address && <p className="text-sm text-muted-foreground mt-0.5">{doc.customer_address}</p>}
            {doc.customer_gst && <p className="text-sm text-muted-foreground mt-0.5">GSTIN: {doc.customer_gst}</p>}
            {doc.customer_phone && <p className="text-sm text-muted-foreground mt-0.5">Phone: {doc.customer_phone}</p>}
            {doc.customer_email && <p className="text-sm text-muted-foreground mt-0.5">Email: {doc.customer_email}</p>}
          </div>

          {/* Line items */}
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 text-left text-muted-foreground">
                  <th className="py-2.5 px-3 font-medium">Description</th>
                  <th className="py-2.5 px-3 font-medium text-right">Qty</th>
                  <th className="py-2.5 px-3 font-medium text-right">Rate</th>
                  <th className="py-2.5 px-3 font-medium text-right">Amount</th>
                  <th className="py-2.5 px-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {doc.items.map((item: any) => (
                  <tr key={item.id} className="border-t">
                    <td className="py-2.5 px-3">{item.description}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums">{item.quantity}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums">{money(item.rate)}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums font-medium">{money(item.amount)}</td>
                    <td className="py-2.5 px-3 text-right">
                      {item.converted ? (
                        <span className="text-success text-xs font-medium">✓ Converted</span>
                      ) : (
                        <button onClick={() => convertLine(item)} className="text-warning underline text-xs">Convert →</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div className="flex justify-end">
            <div className="w-full max-w-xs space-y-1.5">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="tabular-nums">{money(doc.subtotal)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Est. GST</span>
                <span className="tabular-nums">{money(doc.total_gst)}</span>
              </div>
              <div className="flex justify-between text-lg font-bold border-t pt-2 mt-1">
                <span>Total</span>
                <span className="tabular-nums">{money(doc.grand_total)}</span>
              </div>
            </div>
          </div>

          {/* Notes / terms */}
          {(doc.notes || doc.terms_conditions) && (
            <div className="grid md:grid-cols-2 gap-4 border-t pt-6">
              {doc.notes && (
                <div>
                  <h3 className="text-sm font-semibold mb-1">Notes</h3>
                  <p className="text-sm text-muted-foreground whitespace-pre-line">{doc.notes}</p>
                </div>
              )}
              {doc.terms_conditions && (
                <div>
                  <h3 className="text-sm font-semibold mb-1">Terms & Conditions</h3>
                  <p className="text-sm text-muted-foreground whitespace-pre-line">{doc.terms_conditions}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {editing && (
        <EditSalesDocumentDialog
          doc={doc}
          onClose={() => setEditing(false)}
          onSaved={async () => { setEditing(false); await fetchDoc() }}
        />
      )}
      {previewUrl && (
        <PdfPreviewDialog url={previewUrl} title={`${docLabel} ${doc.document_number}`} onClose={() => { URL.revokeObjectURL(previewUrl); setPreviewUrl(null); }} />
      )}
    </div>
  )
}

export default function ViewSalesDocumentPageGuarded() {
  return (
    <RequirePageAccess pageKey="quotations">
      <ViewSalesDocumentPage />
    </RequirePageAccess>
  )
}
