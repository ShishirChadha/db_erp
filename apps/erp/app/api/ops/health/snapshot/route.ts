import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { hasOpsToken } from '@/lib/ops-auth'
import { probeEndpoints } from '@/lib/monitoring-probes'

// Inside view for the daily health report routine: everything only the
// database or Vercel can see, which the cloud routine cannot reach itself (the
// ProDesk is Tailscale-only for SSH/psql). See docs/bible/modules/system-health.md.
//
// Returns stats and timings only -- never business rows. The timed reads below
// run the same shapes as the ERP's heaviest screens and discard the data,
// keeping just milliseconds and a row count. That is how this measures ERP API
// speed without a staff login.
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const RUNS = 3

type Timed = { module: string; name: string; median_ms: number | null; runs_ms: number[]; rows: number | null; error: string | null }

async function timeIt(module: string, name: string, fn: () => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<Timed> {
  const runs: number[] = []
  let rows: number | null = null
  let error: string | null = null
  // Sequential on purpose: run 1 shows a cold path, runs 2-3 a warm one, and
  // running them in parallel would measure contention instead of latency.
  for (let i = 0; i < RUNS; i++) {
    const started = performance.now()
    try {
      const res = await fn()
      runs.push(Math.round(performance.now() - started))
      if (res.error) { error = res.error.message; break }
      rows = Array.isArray(res.data) ? res.data.length : res.data == null ? 0 : 1
    } catch (e) {
      error = e instanceof Error ? e.message : 'failed'
      break
    }
  }
  const sorted = [...runs].sort((a, b) => a - b)
  return { module, name, median_ms: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null, runs_ms: runs, rows, error }
}

function istMonthBounds() {
  const ist = new Date(Date.now() + 5.5 * 3600_000)
  const y = ist.getUTCFullYear(), m = ist.getUTCMonth()
  const pad = (n: number) => String(n).padStart(2, '0')
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  return { from: `${y}-${pad(m + 1)}-01`, to: `${y}-${pad(m + 1)}-${pad(last)}`, today: `${y}-${pad(m + 1)}-${pad(ist.getUTCDate())}` }
}

export async function GET(req: NextRequest) {
  if (!hasOpsToken(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const month = istMonthBounds()
  const started = Date.now()

  const [snapshotRes, endpoints] = await Promise.all([
    supabaseAdmin.rpc('ops_health_snapshot'),
    probeEndpoints(),
  ])

  // One after another, not in parallel, for the same reason as the runs above.
  // Each mirrors the default first load of that screen (list page of 50 with
  // its exact count, plus the counts/summary call the page makes alongside).
  const PAGE = 49
  const probes: Array<[string, string, () => PromiseLike<{ data: unknown; error: { message: string } | null }>]> = [
    ['Live Stock', 'status counts', () =>
      supabaseAdmin.rpc('stock_status_counts', { p_source: 'employee_intake', p_exclude_source: null })],
    ['Live Stock', 'list, first page of 50', () =>
      supabaseAdmin
        .from('asset_ledger')
        .select('id, asset_number, serial_number, status, created_at, sold_at, purchase_order_items ( quantity, sku_master ( full_sku_code, sku_description, category ) )', { count: 'exact' })
        .eq('source', 'employee_intake')
        .order('created_at', { ascending: false, nullsFirst: false })
        .order('id', { ascending: true })
        .range(0, PAGE)],
    ['Stock (main)', 'status counts', () =>
      supabaseAdmin.rpc('stock_status_counts', { p_source: null, p_exclude_source: 'employee_intake' })],
    ['Stock (main)', 'list, first page of 50', () =>
      supabaseAdmin
        .from('asset_ledger')
        .select('id, asset_number, serial_number, status, created_at, purchase_order_items ( quantity, purchase_orders ( po_number, po_date ), sku_master ( full_sku_code, sku_description, category ) )', { count: 'exact' })
        .neq('source', 'employee_intake')
        .order('created_at', { ascending: false, nullsFirst: false })
        .order('id', { ascending: true })
        .range(0, PAGE)],
    ['SKU Master', 'list, first page of 50', () =>
      supabaseAdmin.from('sku_master').select('*', { count: 'exact' }).order('full_sku_code').range(0, PAGE)],
    ['SKU Master', 'active count', () =>
      supabaseAdmin.from('sku_master').select('id', { count: 'exact', head: true }).eq('status', 'active')],
    ['SKU Master', 'low-stock check', () =>
      supabaseAdmin.from('sku_master').select('id, quantity_in_stock, reorder_level').eq('status', 'active')],
    ['Sales', 'ledger, this month, first page of 50', () =>
      supabaseAdmin
        .from('sales')
        .select('*', { count: 'exact' })
        .eq('is_deleted', false)
        .gte('effective_sale_date', month.from)
        .lte('effective_sale_date', month.to)
        .order('effective_sale_date', { ascending: false })
        .order('created_at', { ascending: false })
        .range(0, PAGE)],
    ['Sales', 'this month count', () =>
      supabaseAdmin.from('sales').select('id', { count: 'exact', head: true }).eq('is_deleted', false)
        .gte('effective_sale_date', month.from).lte('effective_sale_date', month.to)],
    ['Purchase Orders', 'list, first page of 50', () =>
      supabaseAdmin.from('purchase_orders').select('*', { count: 'exact' })
        .order('po_date', { ascending: false }).order('created_at', { ascending: false }).range(0, PAGE)],
    ['Purchase Orders', 'latest vendor payments', () =>
      supabaseAdmin.from('vendor_payments').select('po_id, paid_on').order('paid_on', { ascending: false }).limit(200)],
    ['Expenses', 'list, first page of 50', () =>
      supabaseAdmin.from('expenses').select('*, vendors(company_name)', { count: 'exact' })
        .eq('is_deleted', false).order('expense_date', { ascending: false }).range(0, PAGE)],
    ['Dashboard', 'report_kpis month-to-date', () =>
      supabaseAdmin.rpc('report_kpis', {
        p_from: month.from, p_to: month.today, p_compare_from: month.from, p_compare_to: month.today, p_include_financials: false,
      })],
    ['Dashboard', 'report_inventory', () =>
      supabaseAdmin.rpc('report_inventory', { p_include_financials: false })],
  ]
  const erpReads: Timed[] = []
  for (const [module, name, fn] of probes) erpReads.push(await timeIt(module, name, fn))

  // Real visitors, every page of both apps, last 24h (components/WebVitalsReporter.tsx).
  const vitalsRes = await supabaseAdmin.rpc('ops_web_vitals_summary', { p_hours: 24 })

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    // Where this ran, so a region regression (anything but bom1) is visible.
    vercelRegion: process.env.VERCEL_REGION || null,
    snapshot: snapshotRes.data ?? null,
    snapshotError: snapshotRes.error?.message ?? null,
    endpoints,
    erpReads,
    realUserVitals: vitalsRes.data ?? null,
    realUserVitalsError: vitalsRes.error?.message ?? null,
    elapsedMs: Date.now() - started,
  })
}
