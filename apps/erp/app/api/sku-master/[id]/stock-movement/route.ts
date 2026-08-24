import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, hasPageAccess } from '@/lib/auth/session'
import { insertAccessoryMovement } from '@/lib/accessory-movements'
import { logAuditEvent } from '@/lib/audit-log'
import { supabaseAdmin } from '@/lib/supabase/service'

// ---------- POST: record a stock-in or correction for a quantity-only SKU ----------
// Laptops/desktops/etc. get quantity changes from asset_ledger-linked movements
// (intake, sale, reassign). This route is for the fungible categories that have no
// per-unit asset_ledger row (RAM/SSD/CPU/GPU/KBD/MOUSE/ACC) -- e.g. the Accessories
// page's "Receive Stock" action. 'sale' movements are never accepted here -- they're
// only ever created internally by /api/sales-entry, so every stock-out has a sale
// backing it instead of an unexplained manual decrement.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPageAccess(sessionUser, ['accessories', 'new_entry', 'sku_master'])) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const body = await req.json()
  const { movement_type, quantity_change, notes, vendor_id, unit_price, purchase_date } = body

  if (!['receipt', 'adjustment'].includes(movement_type)) {
    return NextResponse.json({ error: "movement_type must be 'receipt' or 'adjustment' here." }, { status: 400 })
  }
  if (!Number.isFinite(quantity_change) || quantity_change === 0) {
    return NextResponse.json({ error: 'quantity_change must be a non-zero number.' }, { status: 400 })
  }
  if (movement_type === 'receipt' && quantity_change < 0) {
    return NextResponse.json({ error: "'receipt' movements must have a positive quantity_change." }, { status: 400 })
  }

  // Vendor/price capture is optional and only meaningful on a receipt -- ignored for
  // 'adjustment' (a count correction, not a purchase). See docs/decisions.md: this is
  // an informal, employee-visible reference layer, distinct from the owner-only formal
  // PO-attach cost/vendor.
  let resolvedVendorId: string | null = null
  let resolvedUnitPrice: number | null = null
  let resolvedPurchaseDate: string | null = null
  if (movement_type === 'receipt') {
    if (vendor_id) {
      const { data: vendor } = await supabaseAdmin
        .from('vendors')
        .select('id')
        .eq('id', vendor_id)
        .eq('is_deleted', false)
        .maybeSingle()
      if (!vendor) return NextResponse.json({ error: 'Selected vendor was not found.' }, { status: 400 })
      resolvedVendorId = vendor_id
    }
    if (unit_price !== undefined && unit_price !== null && unit_price !== '') {
      if (!Number.isFinite(unit_price) || unit_price < 0) {
        return NextResponse.json({ error: 'unit_price must be a non-negative number.' }, { status: 400 })
      }
      resolvedUnitPrice = unit_price
    }
    if (purchase_date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(purchase_date)) {
        return NextResponse.json({ error: 'purchase_date must be in YYYY-MM-DD format.' }, { status: 400 })
      }
      resolvedPurchaseDate = purchase_date
    }
  }

  const { error } = await insertAccessoryMovement({
    skuId: id,
    movementType: movement_type,
    quantityChange: quantity_change,
    vendorId: resolvedVendorId,
    unitPrice: resolvedUnitPrice,
    purchaseDate: resolvedPurchaseDate,
    notes,
    createdBy: sessionUser.id,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'update',
    module: 'sku_master',
    tableName: 'stock_movements',
    recordId: id,
    metadata: { movement_type, quantity_change, notes: notes || null },
  })

  return NextResponse.json({ success: true }, { status: 201 })
}
