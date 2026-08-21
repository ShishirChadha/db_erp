import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'

const KNOWN_TABLES = [
  'sales', 'sale_payments', 'purchase_orders', 'purchase_order_items', 'purchases',
  'sku_master', 'asset_ledger', 'stock_movements', 'repair_jobs', 'customers', 'vendors',
  'invoices', 'invoice_items', 'sales_documents', 'sales_document_items',
]

// Trigger-derived columns are never diffed -- they'd always show as a false "change"
// since the payload's value is stale by definition (CLAUDE.md invariant: never write these).
const TRIGGER_DERIVED: Record<string, string[]> = {
  sku_master: ['quantity_in_stock'],
  sales: ['amount_paid', 'payment_status'],
}
const ALWAYS_IGNORED = ['created_at', 'created_by', 'updated_at', 'updated_by']

function labelFor(row: any): string {
  return row.full_sku_code || row.po_number || row.invoice_number || row.document_number ||
    row.asset_number || row.job_number || row.vendor_code || row.company_name ||
    row.customer_name || row.id
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const payload = body?.payload
  if (!payload || typeof payload !== 'object') return NextResponse.json({ error: 'payload is required' }, { status: 400 })

  const result: Record<string, any> = {}

  for (const table of Object.keys(payload)) {
    if (!KNOWN_TABLES.includes(table)) continue
    const rows: any[] = Array.isArray(payload[table]) ? payload[table] : []
    if (rows.length === 0) {
      result[table] = { toInsert: [], toUpdate: [], unchangedCount: 0, dbOnlyCount: 0 }
      continue
    }

    const ids = rows.map((r) => r.id).filter(Boolean)
    const liveById = new Map<string, any>()
    for (const idChunk of chunk(ids, 500)) {
      const { data: liveRows, error } = await supabaseAdmin.from(table).select('*').in('id', idChunk)
      if (error) return NextResponse.json({ error: `${table}: ${error.message}` }, { status: 500 })
      for (const r of liveRows || []) liveById.set(r.id, r)
    }

    const ignored = new Set([...ALWAYS_IGNORED, 'id', ...(TRIGGER_DERIVED[table] || [])])
    const toInsert: any[] = []
    const toUpdate: any[] = []
    let unchangedCount = 0

    for (const row of rows) {
      const live = liveById.get(row.id)
      if (!live) {
        toInsert.push({ id: row.id, label: labelFor(row) })
        continue
      }
      const changedFields: { field: string; oldValue: unknown; newValue: unknown }[] = []
      for (const key of Object.keys(row)) {
        if (ignored.has(key)) continue
        if (JSON.stringify(live[key]) !== JSON.stringify(row[key])) {
          changedFields.push({ field: key, oldValue: live[key], newValue: row[key] })
        }
      }
      if (changedFields.length > 0) toUpdate.push({ id: row.id, label: labelFor(row), changedFields })
      else unchangedCount++
    }

    // dbOnly = live rows this table has that the uploaded payload never mentions at all.
    // Computed from a lightweight count rather than a second giant id-list query.
    const { count: liveTotalCount } = await supabaseAdmin.from(table).select('id', { count: 'exact', head: true })
    const dbOnlyCount = Math.max((liveTotalCount ?? 0) - liveById.size, 0)

    result[table] = { toInsert, toUpdate, unchangedCount, dbOnlyCount }
  }

  return NextResponse.json({ tables: result })
}
