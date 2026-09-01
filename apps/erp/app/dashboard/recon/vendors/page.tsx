'use client'

import { useEffect, useState, useCallback } from 'react'
import { Loader2, Upload, Sparkles, Check, X, Save, RefreshCw, Trash2, Search, Plus } from 'lucide-react'
import { apiFetch } from '@/lib/api-client'
import { useAsyncAction } from '@/lib/useAsyncAction'
import RequireOwner from '@/components/RequireOwner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { StatusBadge } from '@/components/StatusBadge'
import { AddVendorDialog, type Vendor } from '@/components/AddVendorDialog'

interface DocRow {
  id: string
  file_name: string
  extraction_tier: string | null
  extraction_status: string
  page_count: number | null
  text_layer_chars: number | null
  vendor_id: string | null
  validation_errors: any
  raw_extraction: any
  created_at: string
}

interface Proposal {
  id: string
  document_id: string
  vendor_id: string
  field_name: string
  current_value: string | null
  proposed_value: string | null
  change_kind: 'fill_missing' | 'conflict' | 'derived'
  confidence: 'high' | 'medium' | 'low'
  status: string
  vendors: { company_name: string } | null
}

const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  pending: 'neutral',
  probed: 'info',
  parsed: 'success',
  needs_review: 'warning',
  ai_pending_approval: 'warning',
  failed: 'danger',
  confirmed: 'success',
}

const FIELD_LABELS: Record<string, string> = {
  gst_number: 'GSTIN',
  gst_company_name: 'GST Legal Name',
  company_name: 'Company Name',
  address_line1: 'Address',
  address_line2: 'Address (line 2)',
  city: 'City',
  state: 'State',
  pincode: 'Pincode',
  phone: 'Phone',
  alt_phone: 'Alt Phone',
  email: 'Email',
  has_gst: 'GST Registered',
}

function VendorReconPage() {
  const [recentDocs, setRecentDocs] = useState<DocRow[]>([])
  const [activeDoc, setActiveDoc] = useState<DocRow | null>(null)
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [vendorName, setVendorName] = useState<string | null>(null)
  const [noVendorCandidates, setNoVendorCandidates] = useState<{ id: string; company_name: string; similarity: number }[] | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [err, setErr] = useState('')
  const [allVendors, setAllVendors] = useState<Vendor[]>([])
  const [vendorSearch, setVendorSearch] = useState('')
  const [showAddVendor, setShowAddVendor] = useState(false)

  const loadRecentDocs = useCallback(async () => {
    const res = await apiFetch('/api/documents?doc_kind=vendor_invoice')
    if (res.ok) setRecentDocs(await res.json())
  }, [])

  useEffect(() => { loadRecentDocs() }, [loadRecentDocs])

  const loadProposals = useCallback(async (documentId: string) => {
    const res = await apiFetch(`/api/vendor-recon/proposals?document_id=${documentId}&status=all`)
    if (res.ok) {
      const data: Proposal[] = await res.json()
      setProposals(data)
      setVendorName(data[0]?.vendors?.company_name || null)
    }
  }, [])

  const generateProposals = useCallback(async (documentId: string, vendorId?: string) => {
    setNoVendorCandidates(null)
    const res = await apiFetch('/api/vendor-recon/generate', {
      method: 'POST',
      body: JSON.stringify({ document_id: documentId, vendor_id: vendorId }),
    })
    const json = await res.json()
    if (!res.ok) { setErr(json.error || 'Failed to generate vendor proposals.'); return }
    if (json.status === 'no_vendor_match') {
      setNoVendorCandidates(json.candidates || [])
      if (allVendors.length === 0) {
        const vRes = await apiFetch('/api/vendors')
        if (vRes.ok) setAllVendors(await vRes.json())
      }
      return
    }
    setVendorName(json.vendor?.company_name || null)
    await loadProposals(documentId)
  }, [loadProposals, allVendors.length])

  const vendorSearchResults = vendorSearch.trim().length >= 2
    ? allVendors.filter((v) => v.company_name.toLowerCase().includes(vendorSearch.trim().toLowerCase())).slice(0, 15)
    : []

  const handleVendorCreated = (vendor: Vendor) => {
    setShowAddVendor(false)
    setAllVendors((prev) => [...prev, vendor].sort((a, b) => a.company_name.localeCompare(b.company_name)))
    if (activeDoc) generateProposals(activeDoc.id, vendor.id)
  }

  const openDoc = useCallback(async (doc: DocRow) => {
    setErr('')
    setActiveDoc(doc)
    setNoVendorCandidates(null)
    setVendorSearch('')
    if (['parsed', 'needs_review', 'confirmed'].includes(doc.extraction_status)) {
      await generateProposals(doc.id)
    } else {
      setProposals([])
      setVendorName(null)
    }
  }, [generateProposals])

  const { run: confirmReview, pending: confirming } = useAsyncAction(async () => {
    if (!activeDoc) return
    setErr('')
    const res = await apiFetch(`/api/documents/${activeDoc.id}`, { method: 'PATCH', body: JSON.stringify({ confirm_review: true }) })
    const json = await res.json()
    if (!res.ok) { setErr(json.error || 'Could not confirm this extraction.'); return }
    await loadRecentDocs()
    await openDoc(json.document)
  })

  const { run: deleteDoc, pending: deleting } = useAsyncAction(async (doc: DocRow) => {
    if (!confirm(`Delete "${doc.file_name}"? This cannot be undone.`)) return
    setErr('')
    const res = await apiFetch(`/api/documents/${doc.id}`, { method: 'DELETE' })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) { setErr(json.error || 'Could not delete this document.'); return }
    if (activeDoc?.id === doc.id) { setActiveDoc(null); setProposals([]); setVendorName(null); setNoVendorCandidates(null) }
    await loadRecentDocs()
  })

  const { run: upload, pending: uploading } = useAsyncAction(async () => {
    setErr('')
    if (!file) { setErr('Choose a PDF invoice to upload.'); return }

    const upRes = await apiFetch('/api/storage/upload-url', {
      method: 'POST',
      body: JSON.stringify({ fileName: file.name, contentType: file.type, folder: 'vendor-invoices', fileType: 'invoice', bucket: 'documents' }),
    })
    if (!upRes.ok) { setErr('Could not get an upload URL.'); return }
    const { uploadUrl, key } = await upRes.json()
    const putRes = await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } })
    if (!putRes.ok) { setErr('File upload failed.'); return }

    const regRes = await apiFetch('/api/documents', {
      method: 'POST',
      body: JSON.stringify({ key, file_name: file.name, mime_type: file.type, doc_kind: 'vendor_invoice' }),
    })
    const regJson = await regRes.json()
    if (!regRes.ok) { setErr(regJson.error || 'Failed to register document.'); return }
    if (regJson.duplicate) {
      setErr(`This exact file was already uploaded (${regJson.document.file_name}, status: ${regJson.document.extraction_status}).`)
      await loadRecentDocs()
      return
    }

    setFile(null)
    await loadRecentDocs()

    // Tier 1 -- free, always attempted before ever surfacing the AI option.
    const parseRes = await apiFetch(`/api/documents/${regJson.document.id}/parse`, { method: 'POST' })
    const parseJson = await parseRes.json()
    const { data: refreshed } = await apiFetch('/api/documents?doc_kind=vendor_invoice').then((r) => r.json().then((d) => ({ data: d })))
    const updatedDoc = (refreshed as DocRow[]).find((d) => d.id === regJson.document.id) || regJson.document
    setRecentDocs(refreshed as DocRow[])
    await openDoc(updatedDoc)
  })

  const { run: readWithAi, pending: aiPending } = useAsyncAction(async () => {
    if (!activeDoc) return
    setErr('')
    const res = await apiFetch(`/api/documents/${activeDoc.id}/parse-ai`, { method: 'POST', body: JSON.stringify({ confirm: true }) })
    const json = await res.json()
    if (!res.ok) { setErr(json.error || 'AI extraction failed.'); return }
    await loadRecentDocs()
    await openDoc(json.document)
  })

  const { run: saveTemplate, pending: savingTemplate } = useAsyncAction(async () => {
    if (!activeDoc) return
    setErr('')
    const res = await apiFetch(`/api/documents/${activeDoc.id}/save-template`, { method: 'POST' })
    const json = await res.json()
    if (!res.ok) { setErr(json.error || 'Could not save a template from this document.'); return }
    alert(`Layout saved. Fields learned: ${json.fields_learned.join(', ') || 'none'}.${json.fields_not_learned.length ? ` Not learned: ${json.fields_not_learned.join(', ')}.` : ''}`)
    await loadRecentDocs()
  })

  const decide = async (proposalId: string, action: 'approve' | 'reject') => {
    const res = await apiFetch(`/api/vendor-recon/proposals/${proposalId}/${action}`, { method: 'POST' })
    if (res.ok && activeDoc) await loadProposals(activeDoc.id)
  }

  const approveAll = async () => {
    if (!activeDoc) return
    const res = await apiFetch('/api/vendor-recon/approve-all', { method: 'POST', body: JSON.stringify({ document_id: activeDoc.id }) })
    if (res.ok) await loadProposals(activeDoc.id)
  }

  const pending = proposals.filter((p) => p.status === 'pending')
  const decided = proposals.filter((p) => p.status !== 'pending')
  const safeFillCount = pending.filter((p) => p.change_kind === 'fill_missing' && p.confidence === 'high').length

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Vendor Reconciliation</h1>
        <p className="text-sm text-muted-foreground">Upload a vendor invoice — the vendor's GSTIN, address and contact details are compared against your Vendors master, and only genuine fills or conflicts are proposed.</p>
      </div>

      {err && <div className="text-destructive text-sm border border-destructive/20 bg-destructive/10 rounded p-3">{err}</div>}

      <div className="border rounded p-4 space-y-3">
        <h2 className="font-medium">Upload an invoice</h2>
        <div className="flex items-center gap-3">
          <input type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} className="text-sm" />
          <Button onClick={() => upload()} disabled={uploading || !file} size="sm">
            {uploading && <Loader2 className="size-4 animate-spin mr-1" />}
            <Upload className="size-4 mr-1" /> Upload &amp; Parse
          </Button>
        </div>
      </div>

      <div className="grid md:grid-cols-[16rem_1fr] gap-4">
        <div className="border rounded divide-y max-h-[32rem] overflow-y-auto">
          {recentDocs.length === 0 && <div className="p-3 text-sm text-muted-foreground">No invoices uploaded yet.</div>}
          {recentDocs.map((d) => (
            <div key={d.id} className={`group flex items-start ${activeDoc?.id === d.id ? 'bg-muted' : ''}`}>
              <button onClick={() => openDoc(d)} className="flex-1 text-left p-3 text-sm hover:bg-muted min-w-0">
                <div className="truncate font-medium">{d.file_name}</div>
                <StatusBadge tone={STATUS_TONE[d.extraction_status] || 'neutral'}>{d.extraction_status.replace(/_/g, ' ')}</StatusBadge>
              </button>
              <button
                onClick={() => deleteDoc(d)}
                disabled={deleting}
                title="Delete this document"
                className="p-3 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
        </div>

        <div className="border rounded p-4 space-y-4 min-h-[20rem]">
          {!activeDoc && <div className="text-sm text-muted-foreground">Select an invoice from the list, or upload a new one.</div>}

          {activeDoc && (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">{activeDoc.file_name}</div>
                  <div className="text-xs text-muted-foreground">
                    {activeDoc.page_count ?? '—'} page(s) · {activeDoc.text_layer_chars ?? 0} chars extracted · tier {activeDoc.extraction_tier || 'none yet'}
                  </div>
                </div>
                <StatusBadge tone={STATUS_TONE[activeDoc.extraction_status] || 'neutral'}>{activeDoc.extraction_status.replace(/_/g, ' ')}</StatusBadge>
              </div>

              {activeDoc.extraction_status === 'ai_pending_approval' && (
                <div className="border border-primary/20 bg-info/15 rounded p-3 text-sm flex items-center justify-between">
                  <span>No saved layout matched this invoice. Read it with AI, or save a layout after a first manual/AI read to make future invoices from this vendor free.</span>
                  <Button size="sm" onClick={() => readWithAi()} disabled={aiPending}>
                    {aiPending && <Loader2 className="size-4 animate-spin mr-1" />}
                    <Sparkles className="size-4 mr-1" /> Read with AI
                  </Button>
                </div>
              )}

              {activeDoc.extraction_status === 'failed' && (
                <div className="border border-destructive/20 bg-destructive/10 rounded p-3 text-sm flex items-center justify-between">
                  <span>{activeDoc.validation_errors?.[0]?.message || 'The AI read of this invoice failed.'} Try again once the cause is fixed (e.g. a missing ANTHROPIC_API_KEY).</span>
                  <Button size="sm" variant="outline" onClick={() => readWithAi()} disabled={aiPending}>
                    {aiPending && <Loader2 className="size-4 animate-spin mr-1" />}
                    <RefreshCw className="size-4 mr-1" /> Retry
                  </Button>
                </div>
              )}

              {activeDoc.extraction_status === 'needs_review' && activeDoc.validation_errors && (
                <div className="border border-warning/20 bg-warning/15 rounded p-3 text-sm space-y-2">
                  <div className="font-medium">This extraction's own arithmetic doesn't add up — review before trusting it:</div>
                  <ul className="list-disc pl-5 space-y-0.5">
                    {activeDoc.validation_errors.map((issue: any, i: number) => (
                      <li key={i}>
                        {issue.field === 'lines'
                          ? 'No line items were extracted at all — a saved layout only learns header fields (vendor, GSTIN, totals), never the line-item table. Vendor data below may still be usable, but read with AI if you need this invoice for stock/PO matching too.'
                          : `${issue.field}: expected ₹${issue.expected.toFixed(2)}, extracted ₹${issue.extracted.toFixed(2)}`}
                      </li>
                    ))}
                  </ul>
                  <div className="flex justify-end gap-2">
                    <Button size="sm" onClick={() => readWithAi()} disabled={aiPending}>
                      {aiPending && <Loader2 className="size-4 animate-spin mr-1" />}
                      <Sparkles className="size-4 mr-1" /> Read with AI instead
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => confirmReview()} disabled={confirming}>
                      {confirming && <Loader2 className="size-4 animate-spin mr-1" />}
                      <Check className="size-4 mr-1" /> Reviewed — this is correct
                    </Button>
                  </div>
                </div>
              )}

              {noVendorCandidates && (
                <div className="border border-warning/20 bg-warning/15 rounded p-3 text-sm space-y-3">
                  <div className="font-medium">No vendor matched confidently.</div>
                  {noVendorCandidates.length > 0 && (
                    <ul className="space-y-1">
                      {noVendorCandidates.map((c) => (
                        <li key={c.id} className="flex items-center justify-between">
                          <span>{c.company_name} <span className="text-muted-foreground">({(c.similarity * 100).toFixed(0)}% match)</span></span>
                          <Button size="sm" variant="outline" onClick={() => activeDoc && generateProposals(activeDoc.id, c.id)}>Use this vendor</Button>
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="space-y-1.5 pt-1 border-t border-warning/20/70">
                    <div className="relative">
                      <Search className="size-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={vendorSearch}
                        onChange={(e) => setVendorSearch(e.target.value)}
                        placeholder="Search all vendors by name…"
                        className="h-8 pl-7 bg-card"
                      />
                    </div>
                    {vendorSearch.trim().length >= 2 && (
                      vendorSearchResults.length > 0 ? (
                        <ul className="space-y-1 max-h-40 overflow-y-auto">
                          {vendorSearchResults.map((v) => (
                            <li key={v.id} className="flex items-center justify-between bg-card rounded px-2 py-1">
                              <span>{v.company_name}</span>
                              <Button size="sm" variant="outline" onClick={() => activeDoc && generateProposals(activeDoc.id, v.id)}>Use this vendor</Button>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <div className="text-muted-foreground">No vendor found matching "{vendorSearch.trim()}".</div>
                      )
                    )}
                  </div>

                  <div className="flex justify-end">
                    <Button size="sm" onClick={() => setShowAddVendor(true)}>
                      <Plus className="size-4 mr-1" /> Create new vendor
                    </Button>
                  </div>
                </div>
              )}

              {showAddVendor && (
                <AddVendorDialog onAdded={handleVendorCreated} onClose={() => setShowAddVendor(false)} />
              )}

              {vendorName && (
                <div className="flex items-center justify-between">
                  <div className="text-sm">Matched vendor: <span className="font-medium">{vendorName}</span></div>
                  {['parsed', 'confirmed'].includes(activeDoc.extraction_status) && (
                    <Button size="sm" variant="outline" onClick={() => saveTemplate()} disabled={savingTemplate}>
                      {savingTemplate && <Loader2 className="size-4 animate-spin mr-1" />}
                      <Save className="size-4 mr-1" /> Save layout for this vendor
                    </Button>
                  )}
                </div>
              )}

              {pending.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-medium text-sm">Pending corrections ({pending.length})</h3>
                    {safeFillCount > 0 && (
                      <Button size="sm" variant="outline" onClick={approveAll}>Approve all safe fills ({safeFillCount})</Button>
                    )}
                  </div>
                  <div className="border rounded divide-y">
                    {pending.map((p) => (
                      <div key={p.id} className="p-3 flex items-center justify-between gap-3 text-sm">
                        <div>
                          <div className="font-medium">{FIELD_LABELS[p.field_name] || p.field_name}
                            <span className={`ml-2 text-xs px-1.5 py-0.5 rounded ${p.change_kind === 'conflict' ? 'bg-destructive/10 text-destructive' : p.change_kind === 'derived' ? 'bg-purple/15 text-purple' : 'bg-success/15 text-success'}`}>
                              {p.change_kind === 'conflict' ? 'conflict' : p.change_kind === 'derived' ? 'derived' : 'fill'}
                            </span>
                          </div>
                          <div className="text-muted-foreground">{p.current_value || '—'} → <span className="text-foreground">{p.proposed_value || '—'}</span></div>
                        </div>
                        <div className="flex gap-1 shrink-0">
                          <Button size="sm" variant="outline" onClick={() => decide(p.id, 'approve')}><Check className="size-4" /></Button>
                          <Button size="sm" variant="outline" onClick={() => decide(p.id, 'reject')}><X className="size-4" /></Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {pending.length === 0 && decided.length > 0 && (
                <div className="text-sm text-muted-foreground">All {decided.length} proposal(s) for this invoice have been decided.</div>
              )}

              {decided.length > 0 && (
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer">Decided ({decided.length})</summary>
                  <ul className="mt-2 space-y-1">
                    {decided.map((p) => (
                      <li key={p.id}>{FIELD_LABELS[p.field_name] || p.field_name}: {p.current_value || '—'} → {p.proposed_value || '—'} — <span className="capitalize">{p.status}</span></li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default function VendorReconPageGuarded() {
  return (
    <RequireOwner>
      <VendorReconPage />
    </RequireOwner>
  )
}
