'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { apiFetch } from '@/lib/api-client'
import { useRole } from '@/lib/auth/useRole'
import RequirePageAccess from '@/components/RequirePageAccess'

interface RepairJob {
  id: string
  job_number: string
  problem_description: string | null
  customer_device_description: string | null
  status: string
  customers?: { customer_name: string } | null
}

interface StockRow {
  id: string
  asset_number: string | null
  serial_number: string | null
  sku_code: string
  description: string
  po_id: string | null
}

interface RmaEvent {
  id: string
  status: string
  direction: string
  asset_ledger: { asset_number: string | null; serial_number: string | null } | null
}

interface Sale {
  id: string
  customer_name: string | null
  asset_number: string | null
  sale_total: number
  payment_status: string
  finalized: boolean
}

interface AccessoryPoBacklog {
  sku_id: string
  full_sku_code: string
  sku_description: string
  category: string
  quantity: number
}

function Section({
  title,
  count,
  href,
  loading,
  children,
}: {
  title: string
  count: number
  href: string
  loading: boolean
  children: React.ReactNode
}) {
  if (loading) return null
  if (count === 0) return null
  return (
    <div className="border rounded-lg bg-card shadow-sm p-4">
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-semibold text-foreground">{title} ({count})</h2>
        <Link href={href} className="text-xs text-primary underline">View all</Link>
      </div>
      <ul className="divide-y">{children}</ul>
    </div>
  )
}

function Row({ children }: { children: React.ReactNode }) {
  return <li className="py-2 text-sm text-muted-foreground">{children}</li>
}

// Cross-cutting "check this first thing" checklist -- doesn't replace Repair Jobs,
// RMA, Live Stock, or Sales; it just surfaces what's outstanding across all of them
// in one place, each row deep-linking into the page that actually owns that record.
function PendingTasksPage() {
  const { isOwner } = useRole()
  const [loading, setLoading] = useState(true)

  const [qcPending, setQcPending] = useState<StockRow[]>([])
  const [qcPendingTotal, setQcPendingTotal] = useState(0)
  const [repairJobs, setRepairJobs] = useState<RepairJob[]>([])
  const [repairJobsTotal, setRepairJobsTotal] = useState(0)
  const [rmaOpen, setRmaOpen] = useState<RmaEvent[]>([])
  const [rmaOpenTotal, setRmaOpenTotal] = useState(0)
  const [paymentPending, setPaymentPending] = useState<Sale[]>([])
  const [paymentPendingTotal, setPaymentPendingTotal] = useState(0)
  const [needsPo, setNeedsPo] = useState<StockRow[]>([])
  const [needsInvoice, setNeedsInvoice] = useState<any[]>([])
  const [needsPoAccessories, setNeedsPoAccessories] = useState<AccessoryPoBacklog[]>([])
  const [rentalsDueBack, setRentalsDueBack] = useState<any[]>([])
  const [rentalsDueToBill, setRentalsDueToBill] = useState<any[]>([])

  // Every one of these was previously either an unpaginated fetch (the whole
  // table, just to show up to 8 rows + a count) or waited on the previous
  // batch to resolve before starting -- 8 requests across 3 serial waves on
  // this one page. Now one Promise.all; the four routes that support it
  // (stock/repair-jobs/rma/sales) return their own {data, total} in a single
  // request instead of the old fetch-everything-then-.filter().length. The
  // remaining three (stock-intake, sales-entry, accessory-PO backlog) are
  // naturally-bounded "paperwork not yet done" queues, not historical tables
  // that grow with total sales/purchase volume, so leaving them as a single
  // full fetch each is fine -- they just no longer wait on anything else.
  const fetchAll = useCallback(async () => {
    setLoading(true)
    const [stockRes, repairRes, rentalRes, rmaRes, salesRes, stockIntakeRes, salesEntryRes, accessoryPoRes] = await Promise.all([
      apiFetch('/api/stock?status=qc_pending&page=1&limit=8'),
      apiFetch('/api/repair-jobs?status=intake,in_progress&page=1&limit=8'),
      // Both rental lists are derived from live agreement data -- nothing about
      // "overdue" or "due to bill" is a stored/filterable column, so this one
      // stays a full fetch of the (small, operational-not-historical) active set.
      apiFetch('/api/rentals?status=active'),
      isOwner ? apiFetch('/api/rma?exclude_status=closed&page=1&limit=8') : Promise.resolve(null),
      isOwner ? apiFetch('/api/sales?payment_status_ne=paid&page=1&limit=8') : Promise.resolve(null),
      isOwner ? apiFetch('/api/stock-intake') : Promise.resolve(null),
      isOwner ? apiFetch('/api/sales-entry') : Promise.resolve(null),
      isOwner ? apiFetch('/api/purchase-orders/from-accessory-stock') : Promise.resolve(null),
    ])

    const stockJson = stockRes.ok ? await stockRes.json() : { data: [], total: 0 }
    setQcPending(stockJson.data || [])
    setQcPendingTotal(stockJson.total || 0)

    const repairJson = repairRes.ok ? await repairRes.json() : { data: [], total: 0 }
    setRepairJobs(repairJson.data || [])
    setRepairJobsTotal(repairJson.total || 0)

    const rentalData = rentalRes.ok ? await rentalRes.json() : []
    const today = new Date().toISOString().slice(0, 10)
    setRentalsDueBack(rentalData.filter((r: any) => r.is_overdue))
    setRentalsDueToBill(rentalData.filter((r: any) => r.next_billing_date && r.next_billing_date <= today))

    if (isOwner) {
      const rmaJson = rmaRes?.ok ? await rmaRes.json() : { data: [], total: 0 }
      setRmaOpen(rmaJson.data || [])
      setRmaOpenTotal(rmaJson.total || 0)

      const salesJson = salesRes?.ok ? await salesRes.json() : { data: [], total: 0 }
      setPaymentPending(salesJson.data || [])
      setPaymentPendingTotal(salesJson.total || 0)

      setNeedsPo(stockIntakeRes?.ok ? await stockIntakeRes.json() : [])
      setNeedsInvoice(salesEntryRes?.ok ? await salesEntryRes.json() : [])
      setNeedsPoAccessories(accessoryPoRes?.ok ? await accessoryPoRes.json() : [])
    }
    setLoading(false)
  }, [isOwner])

  useEffect(() => { fetchAll() }, [fetchAll])

  const nothingPending = !loading
    && qcPendingTotal === 0 && repairJobsTotal === 0 && rmaOpenTotal === 0
    && paymentPendingTotal === 0 && needsPo.length === 0 && needsInvoice.length === 0
    && needsPoAccessories.length === 0
    && rentalsDueBack.length === 0 && rentalsDueToBill.length === 0

  return (
    <div className="p-4 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-1">Pending Tasks</h1>
      <p className="text-sm text-muted-foreground mb-4">
        Everything outstanding across Repair Jobs, RMA, Live Stock, and Sales -- check this first thing to see what needs attention today.
      </p>

      {loading && <div className="text-muted-foreground text-sm">Loading...</div>}
      {nothingPending && <div className="text-muted-foreground text-sm">Nothing pending -- you're all caught up.</div>}

      <div className="space-y-4">
        <Section title="Rentals Overdue" count={rentalsDueBack.length} href="/dashboard/rentals" loading={loading}>
          {rentalsDueBack.slice(0, 8).map((r: any) => (
            <Row key={r.id}>
              <span className="font-medium">{r.agreement_number}</span> -- {r.customer_name || 'Unknown'},
              {' '}{r.units_on_rent} unit(s) due back {r.expected_return_date}
            </Row>
          ))}
        </Section>

        <Section title="Rent Due to Bill" count={rentalsDueToBill.length} href="/dashboard/rentals" loading={loading}>
          {rentalsDueToBill.slice(0, 8).map((r: any) => (
            <Row key={r.id}>
              <span className="font-medium">{r.agreement_number}</span> -- {r.customer_name || 'Unknown'},
              {' '}cycle from {r.next_billing_date}
            </Row>
          ))}
        </Section>

        <Section title="Repair Jobs In Progress" count={repairJobsTotal} href="/dashboard/repair-jobs" loading={loading}>
          {repairJobs.slice(0, 8).map(job => (
            <Row key={job.id}>
              <span className="font-medium">{job.job_number}</span> -- {job.customers?.customer_name || 'Unknown customer'}
              {' '}<span className="text-muted-foreground">({(job.problem_description || job.customer_device_description || '').slice(0, 60) || 'no description'})</span>
            </Row>
          ))}
        </Section>

        <Section title="QC Pending Stock" count={qcPendingTotal} href="/dashboard/live-stock" loading={loading}>
          {qcPending.slice(0, 8).map(a => (
            <Row key={a.id}>
              <span className="font-medium">{a.asset_number || (a.serial_number ? `SN: ${a.serial_number}` : 'no tag yet')}</span> -- {a.sku_code} {a.description}
            </Row>
          ))}
        </Section>

        {isOwner && (
          <>
            <Section title="RMA In Progress" count={rmaOpenTotal} href="/dashboard/rma" loading={loading}>
              {rmaOpen.slice(0, 8).map(e => (
                <Row key={e.id}>
                  <span className="font-medium">{e.asset_ledger?.asset_number || e.asset_ledger?.serial_number || 'unit'}</span>
                  {' '}-- {e.direction.replace('_', ' ')}, status: {e.status.replace(/_/g, ' ')}
                </Row>
              ))}
            </Section>

            <Section title="Payment Pending" count={paymentPendingTotal} href="/dashboard/sales" loading={loading}>
              {paymentPending.slice(0, 8).map(s => (
                <Row key={s.id}>
                  <span className="font-medium">{s.customer_name || 'Unknown customer'}</span>
                  {' '}-- ₹{s.sale_total?.toFixed(2)} ({s.payment_status})
                </Row>
              ))}
            </Section>

            <Section title="Needs PO Attached" count={needsPo.length} href="/dashboard/live-stock" loading={loading}>
              {needsPo.slice(0, 8).map((a: any) => (
                <Row key={a.id}>
                  <span className="font-medium">{a.asset_number || (a.serial_number ? `SN: ${a.serial_number}` : 'no tag yet')}</span>
                  {' '}-- {a.sku_master?.full_sku_code}
                </Row>
              ))}
            </Section>

            <Section title="Accessory Stock Needs PO" count={needsPoAccessories.length} href="/dashboard/accessories" loading={loading}>
              {needsPoAccessories.slice(0, 8).map((a) => (
                <Row key={a.sku_id}>
                  <span className="font-medium">{a.sku_description || a.full_sku_code}</span>
                  {' '}-- {a.quantity} unit{a.quantity !== 1 ? 's' : ''} received, no vendor/PO attached yet
                </Row>
              ))}
            </Section>

            <Section title="Needs Invoice" count={needsInvoice.length} href="/dashboard/sales" loading={loading}>
              {needsInvoice.slice(0, 8).map((s: any) => (
                <Row key={s.id}>
                  <span className="font-medium">{s.customer_name || 'Unknown customer'}</span>
                  {' '}-- {s.asset_number || (s.serial_number ? `SN: ${s.serial_number}` : 'accessory')}
                </Row>
              ))}
            </Section>
          </>
        )}
      </div>
    </div>
  )
}

export default function PendingTasksPageGuarded() {
  return (
    <RequirePageAccess pageKey="pending_tasks">
      <PendingTasksPage />
    </RequirePageAccess>
  )
}
