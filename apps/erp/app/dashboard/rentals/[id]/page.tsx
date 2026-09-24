'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { apiFetch } from '@/lib/api-client'
import { useRole } from '@/lib/auth/useRole'
import RequirePageAccess from '@/components/RequirePageAccess'
import { StatusBadge } from '@/components/StatusBadge'
import { ErrorBanner } from '@/components/ErrorBanner'
import { Button } from '@/components/ui/button'
import { AddPaymentDialog } from '@/components/AddPaymentDialog'
import { RecordZohoInvoiceDialog } from '@/components/RecordZohoInvoiceDialog'
import { RENTAL_STATUS_TONES, RENTAL_ITEM_STATUS_TONES, PAYMENT_STATUS_TONES, toneFor } from '@/lib/status-styles'
import { RentalReturnDialog, RentalBuyoutDialog, RentalDepositDialog } from '@/components/RentalActionDialogs'

function money(n: number | null | undefined) {
  if (n == null) return '—'
  return `₹${Math.round(Number(n)).toLocaleString('en-IN')}`
}
function day(d: string | null | undefined) {
  if (!d) return '—'
  return new Date(`${d.slice(0, 10)}T12:00:00.000Z`)
    .toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

function RentalDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { canEditPage, isOwner } = useRole()
  const canEdit = canEditPage('rentals')

  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [returnItem, setReturnItem] = useState<any>(null)
  const [buyoutItem, setBuyoutItem] = useState<any>(null)
  const [payFor, setPayFor] = useState<any>(null)
  const [invoiceFor, setInvoiceFor] = useState<string[] | null>(null)
  const [showDeposit, setShowDeposit] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await apiFetch(`/api/rentals/${id}`)
    if (res.ok) setData(await res.json())
    else setError('Could not load this rental agreement.')
    setLoading(false)
  }, [id])

  useEffect(() => { load() }, [load])

  const generateCharge = async () => {
    setError(null); setBusy(true)
    const res = await apiFetch(`/api/rentals/${id}/charges`, { method: 'POST', body: JSON.stringify({}) })
    setBusy(false)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      return setError(j.error || 'Could not generate the charge.')
    }
    load()
  }

  const closeAgreement = async () => {
    setError(null); setBusy(true)
    const res = await apiFetch(`/api/rentals/${id}/close`, { method: 'POST', body: JSON.stringify({}) })
    setBusy(false)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      return setError(j.error || 'Could not close the agreement.')
    }
    load()
  }

  if (loading) return <div>Loading...</div>
  if (!data) return <ErrorBanner message={error || 'Not found.'} />

  const items = data.rental_agreement_items || []
  const onRent = items.filter((i: any) => i.item_status === 'on_rent')
  const depositHeld = Number(data.security_deposit_amount || 0)

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start gap-4 flex-wrap">
        <div>
          <Link href="/dashboard/rentals" className="text-sm text-muted-foreground underline">← Rentals</Link>
          <h1 className="text-2xl font-bold mt-1">{data.agreement_number}</h1>
          <p className="text-sm text-muted-foreground">{data.customer_name}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <StatusBadge tone={toneFor(RENTAL_STATUS_TONES, data.status)}>{data.status}</StatusBadge>
          {data.is_overdue && <span className="text-xs font-medium text-destructive">Overdue</span>}
        </div>
      </div>

      {error && <ErrorBanner message={error} />}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Rent', value: money(data.rent_amount), sub: data.billing_interval.replace('_', ' ') },
          { label: 'Units out', value: `${onRent.length} / ${items.length}` },
          { label: 'Rent billed', value: money(data.total_rent_billed), sub: `${money(data.total_rent_collected)} collected` },
          { label: 'Deposit held', value: money(depositHeld), sub: data.deposit_refunded_at ? 'settled' : data.deposit_received_at ? 'received' : 'not received' },
        ].map((t) => (
          <div key={t.label} className="border rounded-lg p-3 bg-card">
            <div className="text-xs text-gray-500">{t.label}</div>
            <div className="text-lg font-semibold tabular-nums">{t.value}</div>
            {t.sub && <div className="text-xs text-gray-500 capitalize">{t.sub}</div>}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-3 text-sm">
        <span className="text-gray-500">Start: <b>{day(data.start_date)}</b></span>
        <span className="text-gray-500">Due back: <b>{day(data.expected_return_date)}</b></span>
        <span className="text-gray-500">Next bill: <b>{day(data.next_billing_date)}</b></span>
        <span className="text-gray-500">Received into: <b>{data.payment_account || '—'}</b></span>
      </div>

      {canEdit && data.status === 'active' && (
        <div className="flex flex-wrap gap-2">
          <button onClick={generateCharge} disabled={busy || onRent.length === 0}
            className="bg-primary text-primary-foreground px-3 py-2 rounded text-sm font-medium disabled:opacity-50">
            Generate rent charge
          </button>
          <button onClick={closeAgreement} disabled={busy || onRent.length > 0}
            className="border px-3 py-2 rounded text-sm disabled:opacity-50"
            title={onRent.length > 0 ? 'Record every unit’s return or buyout first' : undefined}>
            Close agreement
          </button>
          {isOwner && depositHeld > 0 && !data.deposit_refunded_at && (
            <button onClick={() => setShowDeposit(true)} className="border px-3 py-2 rounded text-sm">
              Settle deposit
            </button>
          )}
        </div>
      )}

      {/* Units */}
      <div>
        <h2 className="text-lg font-semibold mb-2">Units</h2>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="p-2 text-left">Handed over</th>
                <th className="p-2 text-left">Asset / Serial</th>
                <th className="p-2 text-left">Model</th>
                <th className="p-2 text-left">Returned</th>
                <th className="p-2 text-left">Status</th>
                {canEdit && <th className="p-2 text-left">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {items.map((i: any) => {
                const a = i.asset_ledger
                const sku = a?.sku_master
                return (
                  <tr key={i.id} className="border-t">
                    <td className="p-2 whitespace-nowrap">{day(i.handed_over_at)}</td>
                    <td className="p-2">{a?.asset_number || (a?.serial_number ? `SN ${a.serial_number}` : '—')}</td>
                    <td className="p-2">{[sku?.brand, sku?.model_name].filter(Boolean).join(' ') || sku?.full_sku_code || '—'}</td>
                    <td className="p-2 whitespace-nowrap">{day(i.returned_at)}</td>
                    <td className="p-2">
                      <StatusBadge tone={toneFor(RENTAL_ITEM_STATUS_TONES, i.item_status)}>
                        {i.item_status.replace(/_/g, ' ')}
                      </StatusBadge>
                    </td>
                    {canEdit && (
                      <td className="p-2">
                        {i.item_status === 'on_rent' && (
                          <div className="flex gap-1">
                            <Button variant="link" size="sm" onClick={() => setReturnItem(i)} className="text-xs">Return</Button>
                            <Button variant="link" size="sm" onClick={() => setBuyoutItem(i)} className="text-xs">Buyout</Button>
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Billing history -- these are real sales rows, same as any other sale. A
          long-running rental accrues one row per billing cycle, so this is capped
          with its own scroll rather than growing the page indefinitely (same
          pattern as the QC page's Cost Adjustments list). */}
      <div>
        <h2 className="text-lg font-semibold mb-2">Billing</h2>
        <div className="overflow-auto rounded-md border max-h-96">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="p-2 text-left">Date</th>
                <th className="p-2 text-left">Period</th>
                <th className="p-2 text-left">Kind</th>
                <th className="p-2 text-right">Base</th>
                <th className="p-2 text-right">GST</th>
                <th className="p-2 text-right">Total</th>
                <th className="p-2 text-right">Paid</th>
                <th className="p-2 text-left">Payment</th>
                <th className="p-2 text-left">Invoice</th>
                {canEdit && <th className="p-2 text-left">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {(data.charges || []).length === 0 ? (
                <tr><td colSpan={10} className="p-4 text-center text-muted-foreground">Nothing billed yet.</td></tr>
              ) : data.charges.map((c: any) => (
                <tr key={c.id} className="border-t">
                  <td className="p-2 whitespace-nowrap">{day(c.sale_date)}</td>
                  <td className="p-2 whitespace-nowrap text-xs">
                    {c.rental_period_start ? `${day(c.rental_period_start)} – ${day(c.rental_period_end)}` : '—'}
                  </td>
                  {/* asset_ledger_id set == a buyout (a real unit sale); absent == rent */}
                  <td className="p-2">{c.asset_ledger_id ? 'Buyout' : 'Rent'}</td>
                  <td className="p-2 text-right tabular-nums">{money(c.sale_base_price)}</td>
                  <td className="p-2 text-right tabular-nums">{money(c.sale_gst)}</td>
                  <td className="p-2 text-right tabular-nums">{money(c.sale_total)}</td>
                  <td className="p-2 text-right tabular-nums">{money(c.amount_paid)}</td>
                  <td className="p-2">
                    <StatusBadge tone={toneFor(PAYMENT_STATUS_TONES, c.payment_status)}>{c.payment_status}</StatusBadge>
                  </td>
                  <td className="p-2 text-xs">{c.invoice_number || (c.finalized ? 'finalized' : '—')}</td>
                  {canEdit && (
                    <td className="p-2">
                      <div className="flex gap-1">
                        {c.payment_status !== 'paid' && (
                          <Button variant="link" size="sm" onClick={() => setPayFor(c)} className="text-xs">Payment</Button>
                        )}
                        {!c.finalized && isOwner && (
                          <Button variant="link" size="sm" onClick={() => setInvoiceFor([c.id])} className="text-xs">Invoice</Button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          Every line above is a real sale in the Sales Ledger, so it can be combined with
          other sales for this customer into one GST invoice.
        </p>
      </div>

      {returnItem && (
        <RentalReturnDialog
          agreementId={id} item={returnItem}
          onClose={() => setReturnItem(null)}
          onDone={() => { setReturnItem(null); load() }}
        />
      )}
      {buyoutItem && (
        <RentalBuyoutDialog
          agreementId={id} item={buyoutItem} defaultAccount={data.payment_account}
          onClose={() => setBuyoutItem(null)}
          onDone={() => { setBuyoutItem(null); load() }}
        />
      )}
      {showDeposit && (
        <RentalDepositDialog
          agreementId={id} held={depositHeld}
          onClose={() => setShowDeposit(false)}
          onDone={() => { setShowDeposit(false); load() }}
        />
      )}
      {payFor && (
        <AddPaymentDialog
          saleId={payFor.id}
          balanceDue={Math.max(Number(payFor.sale_total || 0) - Number(payFor.amount_paid || 0), 0)}
          onClose={() => setPayFor(null)}
          onSaved={() => { setPayFor(null); load() }}
        />
      )}
      {invoiceFor && (
        <RecordZohoInvoiceDialog
          saleIds={invoiceFor}
          onClose={() => setInvoiceFor(null)}
          onRecorded={() => { setInvoiceFor(null); load() }}
        />
      )}
    </div>
  )
}

export default function RentalDetailGuarded() {
  return (
    <RequirePageAccess pageKey="rentals">
      <RentalDetailPage />
    </RequirePageAccess>
  )
}
