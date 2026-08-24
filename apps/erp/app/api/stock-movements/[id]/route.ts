import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, hasPageAccess } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'
import { supabaseAdmin } from '@/lib/supabase/service'

// ---------- PATCH: correct a stock movement's remarks / vendor / price / date / payment ----------
// These fields are meant to be quick, in-the-moment entries -- this lets whoever's working
// the ledger go back and fix a typo or wrong amount later without re-recording the whole
// movement (see docs/decisions.md). Deliberately does NOT accept quantity_change or
// movement_type: trg_sync_sku_stock only fires BEFORE INSERT, not UPDATE, so editing a
// past quantity would silently desync sku_master.quantity_in_stock from the ledger, and
// would corrupt every later movement's quantity_before/quantity_after running total for
// this SKU. A quantity correction still goes through a new 'adjustment' movement (the
// existing "Correct Quantity" control) -- a real, auditable entry, not a rewritten one.
// vendor_id/unit_price/purchase_date/payment_account only apply to 'receipt' rows, same
// as at creation time; notes can be edited on any row. Same page-access gate as recording
// the movement in the first place -- not owner-only, since this is operational data, not
// cost/vendor identity.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPageAccess(sessionUser, ['accessories', 'new_entry', 'sku_master'])) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json()

  const { data: existing } = await supabaseAdmin
    .from('stock_movements')
    .select('id, movement_type, notes, vendor_id, unit_price, purchase_date, payment_account')
    .eq('id', id)
    .maybeSingle()
  if (!existing) return NextResponse.json({ error: 'Movement not found.' }, { status: 404 })

  const updates: Record<string, any> = {}

  if (body.notes !== undefined) {
    if (typeof body.notes !== 'string') return NextResponse.json({ error: 'notes must be a string.' }, { status: 400 })
    updates.notes = body.notes || null
  }

  const receiptOnlyFieldsRequested = ['vendor_id', 'unit_price', 'purchase_date', 'payment_account'].some(
    (key) => body[key] !== undefined
  )
  if (receiptOnlyFieldsRequested && existing.movement_type !== 'receipt') {
    return NextResponse.json({ error: 'Vendor, price, purchase date, and payment account only apply to receipt movements.' }, { status: 400 })
  }

  if (body.vendor_id !== undefined) {
    if (body.vendor_id) {
      const { data: vendor } = await supabaseAdmin
        .from('vendors')
        .select('id')
        .eq('id', body.vendor_id)
        .eq('is_deleted', false)
        .maybeSingle()
      if (!vendor) return NextResponse.json({ error: 'Selected vendor was not found.' }, { status: 400 })
      updates.vendor_id = body.vendor_id
    } else {
      updates.vendor_id = null
    }
  }

  if (body.unit_price !== undefined) {
    if (body.unit_price !== null && body.unit_price !== '') {
      if (!Number.isFinite(body.unit_price) || body.unit_price < 0) {
        return NextResponse.json({ error: 'unit_price must be a non-negative number.' }, { status: 400 })
      }
      updates.unit_price = body.unit_price
    } else {
      updates.unit_price = null
    }
  }

  if (body.purchase_date !== undefined) {
    if (body.purchase_date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(body.purchase_date)) {
        return NextResponse.json({ error: 'purchase_date must be in YYYY-MM-DD format.' }, { status: 400 })
      }
      updates.purchase_date = body.purchase_date
    } else {
      updates.purchase_date = null
    }
  }

  if (body.payment_account !== undefined) {
    updates.payment_account = body.payment_account || null
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No editable fields provided.' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('stock_movements')
    .update(updates)
    .eq('id', id)
    .select('id, notes, vendor_id, unit_price, purchase_date, payment_account, vendors(company_name)')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'update',
    module: 'sku_master',
    tableName: 'stock_movements',
    recordId: id,
    metadata: {
      fields: Object.keys(updates),
      old_values: Object.fromEntries(Object.keys(updates).map((k) => [k, (existing as any)[k]])),
      new_values: updates,
    },
  })

  const vendor: any = (data as any).vendors
  return NextResponse.json({
    id: data.id,
    notes: data.notes,
    vendor_id: data.vendor_id,
    vendor_name: (Array.isArray(vendor) ? vendor[0] : vendor)?.company_name ?? null,
    unit_price: data.unit_price,
    purchase_date: data.purchase_date,
    payment_account: data.payment_account,
  })
}
