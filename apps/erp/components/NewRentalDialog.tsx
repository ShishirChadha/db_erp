'use client'

import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '@/lib/api-client'
import { SearchableCustomerSelect } from '@/components/SearchableCustomerSelect'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { ErrorBanner } from '@/components/ErrorBanner'

interface StockUnit {
  id: string
  asset_number: string | null
  serial_number: string | null
  status: string
  full_sku_code?: string | null
  brand?: string | null
  model_name?: string | null
}

// Opens a rental agreement. Units come from ordinary sellable stock via the same
// /api/stock picker the Sell screen uses -- there is no separate rental fleet to
// choose from.
export function NewRentalDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [customerId, setCustomerId] = useState<string | null>(null)
  const [selected, setSelected] = useState<StockUnit[]>([])
  const [units, setUnits] = useState<StockUnit[]>([])
  const [unitSearch, setUnitSearch] = useState('')
  const [unitTerm, setUnitTerm] = useState('')
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [expectedReturn, setExpectedReturn] = useState('')
  const [billingInterval, setBillingInterval] = useState('monthly')
  const [rentAmount, setRentAmount] = useState('')
  const [gstPercentage, setGstPercentage] = useState('18')
  const [paymentAccount, setPaymentAccount] = useState('Digitalbluez')
  const [deposit, setDeposit] = useState('')
  const [depositReceived, setDepositReceived] = useState(false)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [gstEntities, setGstEntities] = useState<Record<string, boolean>>({})

  useEffect(() => {
    const t = setTimeout(() => setUnitTerm(unitSearch), 300)
    return () => clearTimeout(t)
  }, [unitSearch])

  // GST only applies when the resolved entity is GST-registered -- the same fact the
  // server re-checks, fetched here purely so the field isn't shown for Cash/Techtenth.
  useEffect(() => {
    apiFetch('/api/business-profiles/gst-status').then(async (res) => {
      if (res.ok) {
        const rows = await res.json()
        setGstEntities(Object.fromEntries(rows.map((r: any) => [r.key, r.is_gst_registered])))
      }
    })
  }, [])

  const fetchUnits = useCallback(async () => {
    const params = new URLSearchParams({ status: 'ready_for_sale,qc_passed' })
    if (unitTerm) params.set('search', unitTerm)
    params.set('page', '1')
    params.set('limit', '25')
    const res = await apiFetch(`/api/stock?${params.toString()}`)
    if (res.ok) {
      const json = await res.json()
      setUnits(Array.isArray(json) ? json : json.data || [])
    }
  }, [unitTerm])

  useEffect(() => { fetchUnits() }, [fetchUnits])

  const isGstEntity = gstEntities[paymentAccount.toLowerCase()] === true

  const toggleUnit = (u: StockUnit) => {
    setSelected((prev) => prev.some((s) => s.id === u.id) ? prev.filter((s) => s.id !== u.id) : [...prev, u])
  }

  const submit = async () => {
    setError(null)
    if (!customerId) return setError('Select a customer.')
    if (selected.length === 0) return setError('Select at least one unit to rent out.')
    if (!(Number(rentAmount) > 0)) return setError('Enter a rent amount.')

    setSaving(true)
    const res = await apiFetch('/api/rentals', {
      method: 'POST',
      body: JSON.stringify({
        customer_id: customerId,
        asset_ids: selected.map((s) => s.id),
        start_date: startDate,
        expected_return_date: expectedReturn || null,
        billing_interval: billingInterval,
        rent_amount: Number(rentAmount),
        gst_percentage: isGstEntity ? Number(gstPercentage) : null,
        payment_account: paymentAccount,
        security_deposit_amount: Number(deposit) || 0,
        deposit_payment_account: Number(deposit) > 0 ? paymentAccount : null,
        deposit_received: depositReceived,
        notes: notes || null,
      }),
    })
    setSaving(false)
    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      return setError(json.error || 'Failed to create the rental agreement.')
    }
    onCreated()
  }

  const unitLabel = (u: StockUnit) =>
    `${u.asset_number || (u.serial_number ? `SN ${u.serial_number}` : 'Unit')} — ${[u.brand, u.model_name].filter(Boolean).join(' ') || u.full_sku_code || ''}`

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>New Rental</DialogTitle></DialogHeader>

        {error && <ErrorBanner message={error} />}

        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Customer</label>
            <SearchableCustomerSelect value={customerId} onChange={setCustomerId} onCustomerData={() => {}} />
          </div>

          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">
              Units to rent out {selected.length > 0 && `(${selected.length} selected)`}
            </label>
            {selected.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {selected.map((u) => (
                  <span key={u.id} className="text-xs bg-muted px-2 py-1 rounded flex items-center gap-2">
                    {unitLabel(u)}
                    <button type="button" onClick={() => toggleUnit(u)} className="text-muted-foreground">×</button>
                  </span>
                ))}
              </div>
            )}
            <Input
              placeholder="Search sellable stock by asset #, serial, or model..."
              value={unitSearch}
              onChange={(e) => setUnitSearch(e.target.value)}
            />
            <div className="border rounded-md mt-2 max-h-48 overflow-y-auto divide-y">
              {units.length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">No sellable units found.</p>
              ) : units.map((u) => (
                <label key={u.id} className="flex items-center gap-2 p-2 text-sm cursor-pointer hover:bg-muted/50">
                  <Checkbox
                    checked={selected.some((s) => s.id === u.id)}
                    onCheckedChange={() => toggleUnit(u)}
                  />
                  <span>{unitLabel(u)}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Start date</label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Expected return (optional)</label>
              <Input type="date" value={expectedReturn} onChange={(e) => setExpectedReturn(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Billing</label>
              <select
                value={billingInterval}
                onChange={(e) => setBillingInterval(e.target.value)}
                className="border rounded h-8 px-2 text-sm w-full"
              >
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="one_time">One-time (whole period)</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">
                Rent per {billingInterval === 'one_time' ? 'period' : billingInterval === 'quarterly' ? 'quarter' : 'month'} (₹, pre-GST)
              </label>
              <Input type="number" value={rentAmount} onChange={(e) => setRentAmount(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Received into</label>
              <select
                value={paymentAccount}
                onChange={(e) => setPaymentAccount(e.target.value)}
                className="border rounded h-8 px-2 text-sm w-full"
              >
                <option value="Digitalbluez">Digitalbluez</option>
                <option value="Techtenth">Techtenth</option>
                <option value="Cash">Cash</option>
              </select>
            </div>
            {isGstEntity && (
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">GST % (SAC 997313)</label>
                <Input type="number" value={gstPercentage} onChange={(e) => setGstPercentage(e.target.value)} />
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 items-end">
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Security deposit (₹)</label>
              <Input type="number" value={deposit} onChange={(e) => setDeposit(e.target.value)} />
            </div>
            {Number(deposit) > 0 && (
              <label className="flex items-center gap-2 text-sm pb-2">
                <Checkbox checked={depositReceived} onCheckedChange={(c) => setDepositReceived(c === true)} />
                Deposit received
              </label>
            )}
          </div>
          {Number(deposit) > 0 && (
            <p className="text-xs text-gray-500">
              A deposit is held as a refundable liability — it is not revenue and carries no GST.
              Anything withheld at closure is recorded as income then.
            </p>
          )}

          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Notes (optional)</label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          <p className="text-xs text-gray-500">
            The selected unit{selected.length === 1 ? '' : 's'} leave sellable stock immediately.
            On return {selected.length === 1 ? 'it goes' : 'they go'} back into the QC queue before being sold again.
          </p>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button onClick={submit} disabled={saving}>{saving ? 'Creating...' : 'Create Rental'}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
