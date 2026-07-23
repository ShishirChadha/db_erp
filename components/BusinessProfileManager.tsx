'use client'

import { useEffect, useRef, useState } from 'react'
import { apiFetch } from '@/lib/api-client'
import { Loader2, Upload, Eye } from 'lucide-react'

interface BusinessProfile {
  key: string
  legal_name: string
  address: string | null
  state: string | null
  state_code: string | null
  gstin: string | null
  is_gst_registered: boolean
  logo_url: string | null
  signature_url: string | null
  stamp_url: string | null
  bank_details: Record<string, string> | null
  invoice_prefix: string | null
  default_terms: string | null
  default_notes: string | null
  invoicing_mode: 'erp' | 'external'
}

const KEY_LABELS: Record<string, string> = {
  digitalbluez: 'Digitalbluez',
  techtenth: 'Techtenth',
  cash: 'Cash',
}

const IMAGE_FIELDS = [
  { field: 'logo_url', label: 'Logo' },
  { field: 'signature_url', label: 'Signature' },
  { field: 'stamp_url', label: 'Stamp' },
] as const

export default function BusinessProfileManager() {
  const [profiles, setProfiles] = useState<BusinessProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const savingRef = useRef<Set<string>>(new Set())
  const [uploading, setUploading] = useState<string | null>(null)
  const uploadingRef = useRef<Set<string>>(new Set())
  const [edits, setEdits] = useState<Record<string, Partial<BusinessProfile>>>({})
  const [counterInputs, setCounterInputs] = useState<Record<string, string>>({})
  const [settingCounter, setSettingCounter] = useState<string | null>(null)

  const handleSetCounter = async (key: string) => {
    const raw = counterInputs[key]
    if (raw === undefined || raw === '' || isNaN(Number(raw))) { alert('Enter the last Zoho invoice sequence number.'); return }
    if (!confirm(`Set ${KEY_LABELS[key] || key}'s ERP invoice counter so the next generated invoice is #${Number(raw) + 1}?`)) return
    setSettingCounter(key)
    try {
      const res = await apiFetch(`/api/business-profiles/${key}/set-invoice-counter`, {
        method: 'POST',
        body: JSON.stringify({ last_number: Number(raw) }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { alert(data.error || 'Failed to set counter.'); return }
      alert(`Done. The next ERP invoice for ${KEY_LABELS[key] || key} will be #${data.next_will_be}.`)
    } finally {
      setSettingCounter((prev) => (prev === key ? null : prev))
    }
  }

  const fetchProfiles = async () => {
    setLoading(true)
    const res = await apiFetch('/api/business-profiles')
    if (res.ok) {
      const data: BusinessProfile[] = await res.json()
      setProfiles(data)
      const init: Record<string, Partial<BusinessProfile>> = {}
      data.forEach((p) => { init[p.key] = { ...p } })
      setEdits(init)
    }
    setLoading(false)
  }

  useEffect(() => { fetchProfiles() }, [])

  const updateField = (key: string, field: string, value: any) => {
    setEdits((prev) => ({ ...prev, [key]: { ...prev[key], [field]: value } }))
  }

  const updateBankField = (key: string, field: string, value: string) => {
    setEdits((prev) => ({
      ...prev,
      [key]: { ...prev[key], bank_details: { ...(prev[key]?.bank_details || {}), [field]: value } },
    }))
  }

  // Save/upload act on one profile (or one profile+field) at a time -- guard
  // re-entrancy per-key so a double click on the same row's button can't fire
  // a duplicate request.
  const handleSave = async (key: string) => {
    if (savingRef.current.has(key)) return
    savingRef.current.add(key)
    setSaving(key)
    try {
      const res = await apiFetch(`/api/business-profiles/${key}`, {
        method: 'PATCH',
        body: JSON.stringify(edits[key]),
      })
      if (res.ok) {
        await fetchProfiles()
      } else {
        const err = await res.json().catch(() => ({}))
        alert(err.error || 'Save failed')
      }
    } finally {
      savingRef.current.delete(key)
      setSaving(prev => (prev === key ? null : prev))
    }
  }

  const handleUpload = async (key: string, field: string, file: File) => {
    const uploadKey = `${key}:${field}`
    if (uploadingRef.current.has(uploadKey)) return
    uploadingRef.current.add(uploadKey)
    setUploading(uploadKey)
    try {
      const res = await apiFetch('/api/storage/upload-url', {
        method: 'POST',
        body: JSON.stringify({
          fileName: file.name,
          contentType: file.type,
          folder: `business-profiles/${key}`,
          fileType: field.replace('_url', ''),
        }),
      })
      const { uploadUrl, key: storageKey } = await res.json()
      await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } })
      updateField(key, field, storageKey)
    } catch (err) {
      console.error(err)
      alert('Upload failed')
    } finally {
      uploadingRef.current.delete(uploadKey)
      setUploading(prev => (prev === uploadKey ? null : prev))
    }
  }

  const handleView = async (storageKey: string) => {
    const res = await apiFetch('/api/storage/download-url', {
      method: 'POST',
      body: JSON.stringify({ key: storageKey, expiresIn: 300 }),
    })
    const { url } = await res.json()
    window.open(url, '_blank')
  }

  if (loading) return <p className="text-sm text-gray-400">Loading...</p>

  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-600">
        Each entity drives its own invoice branding, GST rules, and numbering series.
        Digitalbluez is GST-registered; Techtenth and Cash issue a non-GST Bill of Supply.
      </p>

      {profiles.map((p) => {
        const e = edits[p.key] || {}
        return (
          <div key={p.key} className="border rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">{KEY_LABELS[p.key] || p.key}</h3>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={!!e.is_gst_registered}
                  onChange={(ev) => updateField(p.key, 'is_gst_registered', ev.target.checked)}
                />
                GST Registered
              </label>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded p-3 space-y-2">
              <label className="flex items-center gap-2 text-sm font-medium text-amber-900">
                <input
                  type="checkbox"
                  checked={e.invoicing_mode === 'external'}
                  onChange={(ev) => updateField(p.key, 'invoicing_mode', ev.target.checked ? 'external' : 'erp')}
                />
                Invoices still generated in Zoho (transition mode)
              </label>
              <p className="text-xs text-amber-800">
                While ON, the ERP will <strong>not</strong> generate invoices for this entity — you record the Zoho
                invoice number instead (Sales Ledger → "Record Zoho Invoice #"). Turn OFF at cutover so the ERP takes over.
                <strong> Before turning OFF</strong>, set the counter below to the last Zoho invoice's sequence number so
                the ERP's first invoice continues the series unbroken.
              </p>
              <div className="flex items-end gap-2">
                <div>
                  <label className="block text-xs text-amber-800 mb-1">Last Zoho invoice # (sequence only, e.g. 695)</label>
                  <input
                    type="number"
                    value={counterInputs[p.key] ?? ''}
                    onChange={(ev) => setCounterInputs((prev) => ({ ...prev, [p.key]: ev.target.value }))}
                    className="border p-1 w-40 rounded text-sm"
                    placeholder="e.g. 695"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => handleSetCounter(p.key)}
                  disabled={settingCounter === p.key}
                  className="text-xs px-3 py-1.5 rounded bg-amber-700 text-white disabled:opacity-50 inline-flex items-center gap-1"
                >
                  {settingCounter === p.key && <Loader2 className="h-3 w-3 animate-spin" />}
                  Set ERP counter
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Legal Name</label>
                <input className="border p-2 w-full rounded text-sm" value={e.legal_name || ''} onChange={(ev) => updateField(p.key, 'legal_name', ev.target.value)} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Invoice Prefix</label>
                <input className="border p-2 w-full rounded text-sm font-mono" value={e.invoice_prefix || ''} onChange={(ev) => updateField(p.key, 'invoice_prefix', ev.target.value.toUpperCase())} />
              </div>
              <div className="col-span-2">
                <label className="block text-xs text-gray-500 mb-1">Address</label>
                <input className="border p-2 w-full rounded text-sm" value={e.address || ''} onChange={(ev) => updateField(p.key, 'address', ev.target.value)} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">State</label>
                <input className="border p-2 w-full rounded text-sm" value={e.state || ''} onChange={(ev) => updateField(p.key, 'state', ev.target.value)} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">State Code</label>
                <input className="border p-2 w-full rounded text-sm font-mono" maxLength={2} value={e.state_code || ''} onChange={(ev) => updateField(p.key, 'state_code', ev.target.value)} />
              </div>
              {e.is_gst_registered && (
                <div className="col-span-2">
                  <label className="block text-xs text-gray-500 mb-1">GSTIN</label>
                  <input className="border p-2 w-full rounded text-sm font-mono" value={e.gstin || ''} onChange={(ev) => updateField(p.key, 'gstin', ev.target.value.toUpperCase())} />
                </div>
              )}
            </div>

            <div className="grid grid-cols-4 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Bank Name</label>
                <input className="border p-2 w-full rounded text-sm" value={e.bank_details?.bank_name || ''} onChange={(ev) => updateBankField(p.key, 'bank_name', ev.target.value)} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">A/c Holder</label>
                <input className="border p-2 w-full rounded text-sm" value={e.bank_details?.account_holder_name || ''} onChange={(ev) => updateBankField(p.key, 'account_holder_name', ev.target.value)} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Account No.</label>
                <input className="border p-2 w-full rounded text-sm" value={e.bank_details?.account_number || ''} onChange={(ev) => updateBankField(p.key, 'account_number', ev.target.value)} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">IFSC</label>
                <input className="border p-2 w-full rounded text-sm" value={e.bank_details?.ifsc_code || ''} onChange={(ev) => updateBankField(p.key, 'ifsc_code', ev.target.value)} />
              </div>
            </div>

            <div className="flex gap-6">
              {IMAGE_FIELDS.map(({ field, label }) => {
                const value = (e as any)[field]
                const busy = uploading === `${p.key}:${field}`
                return (
                  <div key={field} className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 w-16">{label}:</span>
                    {value ? (
                      <button type="button" className="text-xs text-blue-600 flex items-center gap-1" onClick={() => handleView(value)}>
                        <Eye className="h-3 w-3" /> View
                      </button>
                    ) : (
                      <span className="text-xs text-gray-400">Not set</span>
                    )}
                    <label className="text-xs text-gray-600 flex items-center gap-1 cursor-pointer border rounded px-2 py-1 hover:bg-gray-50">
                      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                      Upload
                      <input type="file" className="hidden" accept="image/*" disabled={busy} onChange={(ev) => {
                        const file = ev.target.files?.[0]
                        if (file) handleUpload(p.key, field, file)
                      }} />
                    </label>
                  </div>
                )
              })}
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => handleSave(p.key)}
                disabled={saving === p.key}
                className="bg-blue-600 text-white px-4 py-2 rounded text-sm disabled:opacity-50"
              >
                {saving === p.key ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
