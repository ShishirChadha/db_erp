import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, hasPageAccess } from '@/lib/auth/session'
import { insertAccessoryMovement } from '@/lib/accessory-movements'

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
  const { movement_type, quantity_change, notes } = body

  if (!['receipt', 'adjustment'].includes(movement_type)) {
    return NextResponse.json({ error: "movement_type must be 'receipt' or 'adjustment' here." }, { status: 400 })
  }
  if (!Number.isFinite(quantity_change) || quantity_change === 0) {
    return NextResponse.json({ error: 'quantity_change must be a non-zero number.' }, { status: 400 })
  }
  if (movement_type === 'receipt' && quantity_change < 0) {
    return NextResponse.json({ error: "'receipt' movements must have a positive quantity_change." }, { status: 400 })
  }

  const { error } = await insertAccessoryMovement({
    skuId: id,
    movementType: movement_type,
    quantityChange: quantity_change,
    notes,
    createdBy: sessionUser.id,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true }, { status: 201 })
}
