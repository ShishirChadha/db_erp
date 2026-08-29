// Resolver 1 (highest priority): a question that names a specific record --
// an invoice number, PO number, repair/replacement job number, asset number, or
// serial number -- resolves straight to that record's summary. One indexed lookup
// per candidate table, tried in priority order; the first hit wins.
//
// Every guard here is the exact same helper the record's own page/route uses --
// hasPageAccess for invoices/repair/replacement jobs and assets, isOwner for POs
// (the "Purchases" nav group is owner-only) -- and asset/stock rows go through the
// same redactManyForRole('stock_list', ...) call /api/stock uses, so an employee
// gets exactly the same cost/vendor redaction here as on the Stock page itself.
import { supabaseAdmin } from '@/lib/supabase/service'
import { hasPageAccess, isOwner } from '@/lib/auth/session'
import { redactManyForRole } from '@/lib/auth/redact'
import type { AdvisorResult, ResolverContext } from '../types'

// Broad on purpose: real record numbers in this ERP vary a lot in shape --
// DBIN/2026-27/0001, ATW/26-27/019, MIG-2026-001, RPR-26-018, DBAS23-35 -- so this
// just extracts "an alphanumeric token with a digit in it, at least 5 chars,
// containing a letter" rather than trying to encode every format's regex.
const TOKEN_RE = /\b[A-Za-z][A-Za-z0-9\/-]{3,}\d[A-Za-z0-9\/-]*\b/g

export async function resolveRecord(ctx: ResolverContext): Promise<AdvisorResult | null> {
  const tokens = [...new Set((ctx.text.match(TOKEN_RE) || []).map((t) => t.trim()))]
  if (tokens.length === 0) return null

  for (const token of tokens) {
    const hit =
      (await tryInvoice(token, ctx)) ||
      (await tryPurchaseOrder(token, ctx)) ||
      (await tryRepairJob(token, ctx)) ||
      (await tryReplacementJob(token, ctx)) ||
      (await tryAsset(token, ctx))
    if (hit) return hit
  }
  return null
}

async function tryInvoice(token: string, ctx: ResolverContext): Promise<AdvisorResult | null> {
  if (!hasPageAccess(ctx.user, 'invoices')) return null
  const { data } = await supabaseAdmin
    .from('invoices')
    .select('id, invoice_number, invoice_date, customer_name, grand_total, status, payment_status')
    .ilike('invoice_number', token)
    .eq('is_deleted', false)
    .maybeSingle()
  if (!data) return null
  return {
    resolver: 'record',
    card: {
      kind: 'record',
      title: `Invoice ${data.invoice_number}`,
      subtitle: data.customer_name || undefined,
      lines: [
        { label: 'Date', value: data.invoice_date ?? '—' },
        { label: 'Total', value: formatInr(data.grand_total) },
        { label: 'Status', value: data.status ?? '—' },
        { label: 'Payment', value: data.payment_status ?? '—' },
      ],
      href: `/dashboard/invoices/${data.id}`,
      sourceLabel: 'Invoices',
    },
  }
}

async function tryPurchaseOrder(token: string, ctx: ResolverContext): Promise<AdvisorResult | null> {
  if (!isOwner(ctx.user)) return null // Purchases is an owner-only nav group -- see generated/nav-map.md
  const { data } = await supabaseAdmin
    .from('purchase_orders')
    .select('id, po_number, po_date, vendor_name, po_status, grand_total')
    .ilike('po_number', token)
    .eq('is_deleted', false)
    .maybeSingle()
  if (!data) return null
  return {
    resolver: 'record',
    card: {
      kind: 'record',
      title: `PO ${data.po_number}`,
      subtitle: data.vendor_name || undefined,
      lines: [
        { label: 'Date', value: data.po_date ?? '—' },
        { label: 'Total', value: formatInr(data.grand_total) },
        { label: 'Status', value: data.po_status ?? '—' },
      ],
      href: `/dashboard/purchase-orders/${data.id}`,
      sourceLabel: 'Purchase Orders',
    },
  }
}

async function tryRepairJob(token: string, ctx: ResolverContext): Promise<AdvisorResult | null> {
  if (!hasPageAccess(ctx.user, 'repair_jobs')) return null
  const { data } = await supabaseAdmin
    .from('repair_jobs')
    .select('id, job_number, status, payment_status, customer_id, customers(name)')
    .ilike('job_number', token)
    .maybeSingle()
  if (!data) return null
  const customerName = (data as any).customers?.name
  return {
    resolver: 'record',
    card: {
      kind: 'record',
      title: `Repair Job ${data.job_number}`,
      subtitle: customerName || undefined,
      lines: [
        { label: 'Status', value: data.status ?? '—' },
        { label: 'Payment', value: data.payment_status ?? '—' },
      ],
      href: `/dashboard/repair-jobs?open=${data.id}`,
      sourceLabel: 'Repair Jobs',
    },
  }
}

async function tryReplacementJob(token: string, ctx: ResolverContext): Promise<AdvisorResult | null> {
  if (!hasPageAccess(ctx.user, 'replacement_jobs')) return null
  const { data } = await supabaseAdmin
    .from('replacement_jobs')
    .select('id, job_number, status, customer_id, customers(name)')
    .ilike('job_number', token)
    .maybeSingle()
  if (!data) return null
  const customerName = (data as any).customers?.name
  return {
    resolver: 'record',
    card: {
      kind: 'record',
      title: `Replacement Job ${data.job_number}`,
      subtitle: customerName || undefined,
      lines: [{ label: 'Status', value: data.status ?? '—' }],
      href: `/dashboard/replacement-jobs?open=${data.id}`,
      sourceLabel: 'Replacement Jobs',
    },
  }
}

async function tryAsset(token: string, ctx: ResolverContext): Promise<AdvisorResult | null> {
  if (!hasPageAccess(ctx.user, ['live_stock', 'new_entry', 'invoices', 'stock'])) return null
  const { data } = await supabaseAdmin
    .from('asset_ledger')
    .select('id, asset_number, serial_number, status, qc_grade, qc_status, cost_price, vendor_id, source, sku_id, sku_master(brand, model_name)')
    .or(`asset_number.ilike.${token},serial_number.ilike.${token}`)
    .maybeSingle()
  if (!data) return null
  const [redacted] = await redactManyForRole([data], 'stock_list', ctx.user.role)
  const sku = (redacted as any).sku_master
  const lines: { label: string; value: string }[] = [
    { label: 'Status', value: redacted.status ?? '—' },
    { label: 'QC', value: redacted.qc_status ?? '—' },
  ]
  if (redacted.qc_grade) lines.push({ label: 'Grade', value: redacted.qc_grade })
  if ('cost_price' in redacted && redacted.cost_price != null) {
    lines.push({ label: 'Cost', value: formatInr(redacted.cost_price) })
  }
  return {
    resolver: 'record',
    card: {
      kind: 'record',
      title: redacted.asset_number || redacted.serial_number || 'Asset',
      subtitle: sku ? [sku.brand, sku.model_name].filter(Boolean).join(' ') : undefined,
      lines,
      href: `/dashboard/stock/${redacted.id}`,
      sourceLabel: 'Stock',
    },
  }
}

function formatInr(n: number | null | undefined): string {
  if (n == null) return '—'
  return '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })
}
