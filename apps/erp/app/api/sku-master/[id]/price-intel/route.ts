import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { getVendorName } from '@/lib/purchase-utils'

// ---------- GET: Price Cockpit intel for one SKU -- buy-side vendor comparison ----------
// Unlike /api/sku-master/[id]/history (which stays open to any role with accessories
// access and merely omits its owner-only sections), this route is entirely cost/vendor
// data end to end, so it is gated shut for anyone but the owner rather than partially
// redacted -- there is no non-owner-safe subset to return.
//
// Sources unioned so a repeat-purchase item's full picture shows regardless of which
// door it came in through:
//   - purchase_order_items (fungible + serialized PO buys) -- the primary, structured source
//   - asset_ledger (cost_price/vendor_id/received_at) -- catches serialized units whose
//     cost never became a purchase_order_items row (e.g. legacy-linked or intake-sourced)
//   - purchases (legacy flat table) -- matched best-effort by text sku code, since it has
//     no FK to sku_master; included so pre-PO-system history isn't silently missing
// Aggregation is entirely in-memory over these rows -- no stored aggregate, no DB view,
// so it can never drift from the underlying ledgers.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params

  const { data: sku, error: skuErr } = await supabaseAdmin
    .from('sku_master')
    .select('id, full_sku_code, base_sku_code, sku_description, category, brand, model_name, specifications, quantity_in_stock, status, base_cost, selling_price_default, web_price, market_price')
    .eq('id', id)
    .single()
  if (skuErr || !sku) return NextResponse.json({ error: 'SKU not found' }, { status: 404 })

  // Every price below is normalized to the SAME basis -- excl. GST (pre-tax unit cost)
  // -- since that's what purchase_order_items.unit_price and asset_ledger.cost_price
  // already store (see /api/purchase-orders/route.ts:146-160, which writes base_price
  // straight into both `base_price` and `unit_price`). The legacy `purchases` table is
  // the one source that instead stores a post-GST `total_price`, which is why a raw mix
  // of these previously showed an inflated, inconsistent number here -- it's normalized
  // back to `base_price` below so every row and every aggregate means the same thing.
  // `price_incl_gst` is derived per row (price_excl_gst * (1 + gst_percentage/100)) so
  // the UI can show both without a second, divergent calculation.
  type Row = { vendor_name: string | null; date: string | null; price_excl_gst: number | null; gst_percentage: number | null; quantity: number; source: string; ref: string | null }
  const rows: Row[] = []

  // 1) purchase_order_items -- primary structured source
  const { data: poItems } = await supabaseAdmin
    .from('purchase_order_items')
    .select('quantity, unit_price, gst_percentage, created_at, purchase_orders(po_number, po_date, vendor_name)')
    .eq('sku_id', id)
    .order('created_at', { ascending: false })
  for (const item of (poItems || []) as any[]) {
    rows.push({
      vendor_name: item.purchase_orders?.vendor_name || null,
      date: item.purchase_orders?.po_date || item.created_at,
      price_excl_gst: item.unit_price,
      gst_percentage: item.gst_percentage,
      quantity: item.quantity,
      source: 'purchase_order',
      ref: item.purchase_orders?.po_number || null,
    })
  }

  // 2) asset_ledger -- serialized units, catches cost recorded outside a PO-item row
  const { data: assetRows } = await supabaseAdmin
    .from('asset_ledger')
    .select('cost_price, gst_percentage, vendor_id, received_at, created_at, asset_number, source')
    .eq('sku_id', id)
    .not('cost_price', 'is', null)
    .order('created_at', { ascending: false })
  const vendorIds = [...new Set((assetRows || []).map((a: any) => a.vendor_id).filter(Boolean))]
  const vendorNameById = new Map<string, string>()
  await Promise.all(vendorIds.map(async (vid) => {
    const name = await getVendorName(vid as string)
    if (name) vendorNameById.set(vid as string, name)
  }))
  for (const a of (assetRows || []) as any[]) {
    rows.push({
      vendor_name: a.vendor_id ? vendorNameById.get(a.vendor_id) || null : null,
      date: a.received_at || a.created_at,
      price_excl_gst: a.cost_price,
      gst_percentage: a.gst_percentage,
      quantity: 1,
      source: a.source === 'legacy_purchase' ? 'asset_legacy' : 'asset_ledger',
      ref: a.asset_number || null,
    })
  }

  // 3) legacy `purchases` -- best-effort text-code match, no FK exists to sku_master.
  // Uses `base_price` (pre-GST), NOT `total_price` (which already includes gst_amount),
  // so this source lines up with the pre-GST basis every other source uses above.
  const codes = [sku.full_sku_code, sku.base_sku_code].filter(Boolean)
  if (codes.length > 0) {
    const { data: legacyRows } = await supabaseAdmin
      .from('purchases')
      .select('vendor_name, purchase_date, base_price, gst, asset_number, is_deleted')
      .in('sku', codes)
      .eq('is_deleted', false)
      .order('purchase_date', { ascending: false })
    for (const p of (legacyRows || []) as any[]) {
      rows.push({
        vendor_name: p.vendor_name || null,
        date: p.purchase_date,
        price_excl_gst: p.base_price,
        gst_percentage: p.gst,
        quantity: 1,
        source: 'legacy_purchase',
        ref: p.asset_number || null,
      })
    }
  }

  // Sort newest-first across all sources combined
  rows.sort((a, b) => (b.date || '').localeCompare(a.date || ''))

  const inclGst = (priceExclGst: number, gstPercentage: number | null) =>
    Math.round(priceExclGst * (1 + (gstPercentage || 0) / 100) * 100) / 100

  // Per-vendor aggregation -- last/min/avg price + how many times bought, keyed by
  // vendor name (the only identity every source agrees on; purchase_orders denormalizes
  // vendor_name rather than always carrying vendor_id, and legacy purchases has no
  // vendor_id at all). Aggregated on the excl.-GST figure (GST% varies bought-to-bought,
  // so an incl.-GST average isn't meaningful) -- the incl.-GST figure is then derived
  // per aggregate using that vendor's most recent GST%.
  type VendorAgg = { vendor_name: string; times_bought: number; last_price_excl_gst: number; last_gst_percentage: number | null; last_date: string | null; min_price_excl_gst: number; sum_price_excl_gst: number }
  const byVendor = new Map<string, VendorAgg>()
  for (const r of rows) {
    if (!r.vendor_name || r.price_excl_gst == null) continue
    const key = r.vendor_name
    const existing = byVendor.get(key)
    if (!existing) {
      byVendor.set(key, { vendor_name: key, times_bought: 1, last_price_excl_gst: r.price_excl_gst, last_gst_percentage: r.gst_percentage, last_date: r.date, min_price_excl_gst: r.price_excl_gst, sum_price_excl_gst: r.price_excl_gst })
    } else {
      // rows are already sorted newest-first, so the first occurrence for a vendor is
      // already its last purchase -- later occurrences only ever update min/avg/count.
      existing.times_bought += 1
      existing.min_price_excl_gst = Math.min(existing.min_price_excl_gst, r.price_excl_gst)
      existing.sum_price_excl_gst += r.price_excl_gst
    }
  }
  const vendor_comparison = [...byVendor.values()]
    .map((v) => {
      const avg_price_excl_gst = Math.round((v.sum_price_excl_gst / v.times_bought) * 100) / 100
      return {
        vendor_name: v.vendor_name,
        times_bought: v.times_bought,
        last_date: v.last_date,
        last_price_excl_gst: v.last_price_excl_gst,
        last_price_incl_gst: inclGst(v.last_price_excl_gst, v.last_gst_percentage),
        min_price_excl_gst: v.min_price_excl_gst,
        avg_price_excl_gst,
      }
    })
    .sort((a, b) => (b.last_date || '').localeCompare(a.last_date || ''))

  // Competitor benchmark (Phase 3) -- folded in here so the cockpit has everything for
  // one SKU in a single request; writes still go through their own owner-gated route
  // (market-observations) since they're a separate mutation, not part of this GET.
  const { data: observationRows } = await supabaseAdmin
    .from('market_price_observations')
    .select('id, competitor, price, condition_grade, warranty_months, source_url, notes, observed_at')
    .eq('sku_id', id)
    .eq('is_deleted', false)
    .order('observed_at', { ascending: false })
  const observations = observationRows || []
  const competitorPrices = observations.map((o: any) => o.price).filter((p: number) => p != null)
  const marketBenchmark = competitorPrices.length
    ? { min: Math.min(...competitorPrices), median: median(competitorPrices), count: competitorPrices.length }
    : null

  return NextResponse.json({
    sku,
    vendor_comparison,
    history: rows.map((r) => ({
      date: r.date,
      vendor_name: r.vendor_name,
      price_excl_gst: r.price_excl_gst,
      price_incl_gst: r.price_excl_gst != null ? inclGst(r.price_excl_gst, r.gst_percentage) : null,
      gst_percentage: r.gst_percentage,
      quantity: r.quantity,
      source: r.source,
      ref: r.ref,
    })),
    observations,
    market_benchmark: marketBenchmark,
  })
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}
