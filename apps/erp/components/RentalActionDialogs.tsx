'use client'

import { useState } from 'react'
import { apiFetch } from '@/lib/api-client'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { ErrorBanner } from '@/components/ErrorBanner'

function unitLabel(item: any) {
  const a = item?.asset_ledger
  return a?.asset_number || (a?.serial_number ? `SN ${a.serial_number}` : 'this unit')
}

// ---------- Return ----------
export function RentalReturnDialog({ agreementId, item, onClose, onDone }: {
  agreementId: string; item: any; onClose: () => void; onDone: () => void
}) {
  const [notes, setNotes] = useState('')
  const [lost, setLost] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setError(null); setSaving(true)
    const res = await apiFetch(`/api/rentals/${agreementId}/items/${item.id}/return`, {
      method: 'POST',
      body: JSON.stringify({ return_condition_notes: notes || null, lost_damaged: lost }),
    })
    setSaving(false)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      return setError(j.error || 'Could not record the return.')
    }
    onDone()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Return {unitLabel(item)}</DialogTitle></DialogHeader>
        {error && <ErrorBanner message={error} />}
        <div className="space-y-4">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={lost} onCheckedChange={(c) => setLost(c === true)} />
            Unit was lost or damaged beyond use (write off instead of restocking)
          </label>
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Condition notes</label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Scratches on lid, battery weak..." />
          </div>
          <p className="text-xs text-gray-500">
            {lost
              ? 'The unit will be scrapped. It already left stock when it went out, so stock levels do not change again.'
              : 'The unit goes back into the QC queue — not straight to sellable — so it is re-checked before resale or re-rental.'}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button onClick={submit} disabled={saving}>{saving ? 'Saving...' : lost ? 'Write off' : 'Record return'}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ---------- Buyout ----------
export function RentalBuyoutDialog({ agreementId, item, defaultAccount, onClose, onDone }: {
  agreementId: string; item: any; defaultAccount: string | null; onClose: () => void; onDone: () => void
}) {
  const [price, setPrice] = useState('')
  const [paid, setPaid] = useState('')
  const [account, setAccount] = useState(defaultAccount || 'Digitalbluez')
  const [saleDate, setSaleDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setError(null)
    if (!(Number(price) > 0)) return setError('Enter the buyout price.')
    setSaving(true)
    const res = await apiFetch(`/api/rentals/${agreementId}/items/${item.id}/buyout`, {
      method: 'POST',
      body: JSON.stringify({
        sale_base_price: Number(price),
        amount_paid: Number(paid) || 0,
        payment_account: account,
        sale_date: saleDate,
      }),
    })
    setSaving(false)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      return setError(j.error || 'Could not record the buyout.')
    }
    onDone()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Buyout — {unitLabel(item)}</DialogTitle></DialogHeader>
        {error && <ErrorBanner message={error} />}
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Buyout price (₹, pre-GST)</label>
              <Input type="number" value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Received now (₹)</label>
              <Input type="number" value={paid} onChange={(e) => setPaid(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Sale date</label>
              <Input type="date" value={saleDate} onChange={(e) => setSaleDate(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Received into</label>
              <select value={account} onChange={(e) => setAccount(e.target.value)} className="border rounded h-8 px-2 text-sm w-full">
                <option value="Digitalbluez">Digitalbluez</option>
                <option value="Techtenth">Techtenth</option>
                <option value="Cash">Cash</option>
              </select>
            </div>
          </div>
          <p className="text-xs text-gray-500">
            The renter keeps the unit and it is recorded as a normal sale in the Sales Ledger.
            Rent already billed stays as it is — it is not adjusted against this price automatically.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button onClick={submit} disabled={saving}>{saving ? 'Saving...' : 'Record buyout'}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ---------- Deposit settlement (owner only) ----------
export function RentalDepositDialog({ agreementId, held, onClose, onDone }: {
  agreementId: string; held: number; onClose: () => void; onDone: () => void
}) {
  const [refund, setRefund] = useState(String(held))
  const [reason, setReason] = useState('')
  const [recordIncome, setRecordIncome] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const forfeited = Math.max(Math.round((held - Number(refund || 0)) * 100) / 100, 0)

  const submit = async () => {
    setError(null)
    if (forfeited > 0.5 && !reason.trim()) return setError('Give a reason for withholding part of the deposit.')
    setSaving(true)
    const res = await apiFetch(`/api/rentals/${agreementId}/deposit`, {
      method: 'POST',
      body: JSON.stringify({
        refund_amount: Number(refund || 0),
        deduction_reason: reason || null,
        record_forfeited_as_income: recordIncome,
      }),
    })
    setSaving(false)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      return setError(j.error || 'Could not settle the deposit.')
    }
    onDone()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Settle security deposit</DialogTitle></DialogHeader>
        {error && <ErrorBanner message={error} />}
        <div className="space-y-4">
          <p className="text-sm">Deposit held: <b className="tabular-nums">₹{held.toLocaleString('en-IN')}</b></p>
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Refunding (₹)</label>
            <Input type="number" value={refund} onChange={(e) => setRefund(e.target.value)} />
          </div>
          {forfeited > 0.5 && (
            <>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">
                  Reason for withholding ₹{forfeited.toLocaleString('en-IN')}
                </label>
                <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Screen damage, missing charger..." />
              </div>
              <label className="flex items-start gap-2 text-sm">
                <Checkbox checked={recordIncome} onCheckedChange={(c) => setRecordIncome(c === true)} />
                <span>
                  Record the withheld ₹{forfeited.toLocaleString('en-IN')} as income
                  <span className="block text-xs text-gray-500">
                    A deposit is a liability while held, but anything kept becomes taxable income —
                    this adds it to the Sales Ledger so it is reported and taxed correctly.
                  </span>
                </span>
              </label>
            </>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button onClick={submit} disabled={saving}>{saving ? 'Saving...' : 'Settle deposit'}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
