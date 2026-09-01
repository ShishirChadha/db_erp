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
  const [repairJobs, setRepairJobs] = useState<RepairJob[]>([])
  const [rmaOpen, setRmaOpen] = useState<RmaEvent[]>([])
  const [paymentPending, setPaymentPending] = useState<Sale[]>([])
  const [needsPo, setNeedsPo] = useState<StockRow[]>([])
  const [needsInvoice, setNeedsInvoice] = useState<any[]>([])
  const [needsPoAccessories, setNeedsPoAccessories] = useState<AccessoryPoBacklog[]>([])

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const [stockRes, repairRes] = await Promise.all([
      apiFetch('/api/stock?status=qc_pending'),
      apiFetch('/api/repair-jobs'),
    ])
    setQcPending(stockRes.ok ? await stockRes.json() : [])
    const repairData = repairRes.ok ? await repairRes.json() : []
    setRepairJobs(repairData.filter((r: any) => ['intake', 'in_progress'].includes(r.status)))

    if (isOwner) {
      const [rmaRes, salesRes, stockIntakeRes, salesEntryRes, accessoryPoRes] = await Promise.all([
        apiFetch('/api/rma'),
        apiFetch('/api/sales'),
        apiFetch('/api/stock-intake'),
        apiFetch('/api/sales-entry'),
        apiFetch('/api/purchase-orders/from-accessory-stock'),
      ])
      const rmaData = rmaRes.ok ? await rmaRes.json() : []
      setRmaOpen(rmaData.filter((e: any) => e.status !== 'closed'))
      const salesData = salesRes.ok ? await salesRes.json() : []
      setPaymentPending(salesData.filter((s: any) => s.payment_status !== 'paid'))
      const intakeData = stockIntakeRes.ok ? await stockIntakeRes.json() : []
      setNeedsPo(intakeData)
      setNeedsInvoice(salesEntryRes.ok ? await salesEntryRes.json() : [])
      setNeedsPoAccessories(accessoryPoRes.ok ? await accessoryPoRes.json() : [])
    }
    setLoading(false)
  }, [isOwner])

  useEffect(() => { fetchAll() }, [fetchAll])

  const nothingPending = !loading
    && qcPending.length === 0 && repairJobs.length === 0 && rmaOpen.length === 0
    && paymentPending.length === 0 && needsPo.length === 0 && needsInvoice.length === 0
    && needsPoAccessories.length === 0

  return (
    <div className="p-4 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-1">Pending Tasks</h1>
      <p className="text-sm text-muted-foreground mb-4">
        Everything outstanding across Repair Jobs, RMA, Live Stock, and Sales -- check this first thing to see what needs attention today.
      </p>

      {loading && <div className="text-muted-foreground text-sm">Loading...</div>}
      {nothingPending && <div className="text-muted-foreground text-sm">Nothing pending -- you're all caught up.</div>}

      <div className="space-y-4">
        <Section title="Repair Jobs In Progress" count={repairJobs.length} href="/dashboard/repair-jobs" loading={loading}>
          {repairJobs.slice(0, 8).map(job => (
            <Row key={job.id}>
              <span className="font-medium">{job.job_number}</span> -- {job.customers?.customer_name || 'Unknown customer'}
              {' '}<span className="text-muted-foreground">({(job.problem_description || job.customer_device_description || '').slice(0, 60) || 'no description'})</span>
            </Row>
          ))}
        </Section>

        <Section title="QC Pending Stock" count={qcPending.length} href="/dashboard/live-stock" loading={loading}>
          {qcPending.slice(0, 8).map(a => (
            <Row key={a.id}>
              <span className="font-medium">{a.asset_number || (a.serial_number ? `SN: ${a.serial_number}` : 'no tag yet')}</span> -- {a.sku_code} {a.description}
            </Row>
          ))}
        </Section>

        {isOwner && (
          <>
            <Section title="RMA In Progress" count={rmaOpen.length} href="/dashboard/rma" loading={loading}>
              {rmaOpen.slice(0, 8).map(e => (
                <Row key={e.id}>
                  <span className="font-medium">{e.asset_ledger?.asset_number || e.asset_ledger?.serial_number || 'unit'}</span>
                  {' '}-- {e.direction.replace('_', ' ')}, status: {e.status.replace(/_/g, ' ')}
                </Row>
              ))}
            </Section>

            <Section title="Payment Pending" count={paymentPending.length} href="/dashboard/sales" loading={loading}>
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
