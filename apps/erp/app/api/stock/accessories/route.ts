import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, hasPageAccess } from '@/lib/auth/session'
import { parsePagination } from '@/lib/pagination'
import { NON_SERIALIZED_CATEGORIES } from '@/lib/sku-categories'
import { getLastVendorsBySku } from '@/lib/purchase-utils'
import { getLastEntryVendorsBySku, getUnattachedBacklogBySku, getLastMovementAtBySku } from '@/lib/accessory-movements'
import { redactManyForRole } from '@/lib/auth/redact'
import { withRetry } from '@/lib/db-retry'

// ---------- GET: current (in-stock) accessories ----------
// Counterpart to /api/stock/sold-accessories, for the main Stock page's new
// "Accessories" tab -- accessories have no asset_ledger row, so they're otherwise
// entirely invisible from that page. Cost/backlog/last-vendor fields are always fetched
// here and stripped afterward via the owner-configurable redaction_rules policy
// (lib/auth/redact.ts, shape 'accessories'), same mechanism as sku_master/stock_list --
// everything else (name, category, brand, qty, selling price) is visible to anyone with
// stock access, same as the rest of /api/stock.
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPageAccess(sessionUser, ['live_stock', 'new_entry', 'invoices'])) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const search = searchParams.get('search')
  const pagination = parsePagination(searchParams, 20)

  const baseColumns = 'id, full_sku_code, sku_description, category, brand, model_name, quantity_in_stock, selling_price_default'
  let query = supabaseAdmin
    .from('sku_master')
    .select(`${baseColumns}, base_cost`)
    .in('category', NON_SERIALIZED_CATEGORIES)
    .eq('status', 'active')
    .gt('quantity_in_stock', 0)

  if (search) {
    query = query.or(`full_sku_code.ilike.%${search}%,sku_description.ilike.%${search}%,brand.ilike.%${search}%,model_name.ilike.%${search}%`)
  }

  // Sorted by last-modified desc below (depends on stock_movements, not a sku_master
  // column, so pagination's .range() can't apply at this query stage) -- fetched whole
  // and sliced in memory instead. This list is small (in-stock accessories only).
  const { data: skus, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // "Needs PO" backlog + last vendor + last-modified, cheap to derive alongside since
  // this list is already small. Always computed; redacted below where applicable.
  let backlogBySkuId = new Map<string, number>()
  let lastVendorBySkuId = new Map<string, string>()
  let lastEntryBySkuId = new Map<string, { vendorName: string; unitPrice: number | null; gstPercentage: number | null; purchaseDate: string | null }>()
  let lastMovementAtBySkuId = new Map<string, string>()
  if (skus && skus.length > 0) {
    const skuIds = skus.map((s: any) => s.id)

    // All four only depend on skuIds -- concurrent rather than sequential round
    // trips, same fix already applied to /api/stock and /api/sales.
    const [backlog, lastVendors, lastEntries, lastMovementAt] = await Promise.all([
      withRetry(() => getUnattachedBacklogBySku(skuIds)),
      withRetry(() => getLastVendorsBySku(skuIds)),
      withRetry(() => getLastEntryVendorsBySku(skuIds)),
      withRetry(() => getLastMovementAtBySku(skuIds)),
    ])
    backlogBySkuId = backlog
    lastVendorBySkuId = lastVendors
    lastEntryBySkuId = lastEntries
    lastMovementAtBySkuId = lastMovementAt
  }

  const result = (skus || []).map((s: any) => {
    const lastEntry = lastEntryBySkuId.get(s.id)
    return {
      ...s,
      needs_po_qty: backlogBySkuId.get(s.id) || 0,
      last_vendor: lastVendorBySkuId.get(s.id) || null,
      // Employee-entered receipt vendor/price -- visible to every role, unlike the
      // fields above (redacted below for 'accessories' shape). See docs/decisions.md.
      last_entry_vendor: lastEntry?.vendorName || null,
      last_entry_price: lastEntry?.unitPrice ?? null,
      last_entry_gst_percentage: lastEntry?.gstPercentage ?? null,
      last_entry_date: lastEntry?.purchaseDate || null,
      last_modified_at: lastMovementAtBySkuId.get(s.id) || null,
    }
  })

  // Most recently touched (any stock movement -- receipt, sale, adjustment, return,
  // damage) first. A SKU with no movement at all (shouldn't happen for qty > 0, but
  // kept defensive) sorts last, tiebroken by SKU code for stability.
  result.sort((a, b) => {
    if (a.last_modified_at && b.last_modified_at) return a.last_modified_at < b.last_modified_at ? 1 : a.last_modified_at > b.last_modified_at ? -1 : 0
    if (a.last_modified_at) return -1
    if (b.last_modified_at) return 1
    return String(a.full_sku_code).localeCompare(String(b.full_sku_code))
  })

  const total = result.length
  const paged = pagination ? result.slice(pagination.from, pagination.to + 1) : result

  const redacted = await redactManyForRole(paged, 'accessories', sessionUser.role)

  if (pagination) return NextResponse.json({ data: redacted, total })
  return NextResponse.json(redacted)
}
