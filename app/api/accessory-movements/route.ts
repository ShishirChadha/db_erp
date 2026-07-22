import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth/session'
import { insertAccessoryMovement } from '@/lib/accessory-movements'

// ---------- POST: log accessory stock received (or a manual correction) ----------
// 'out'/'return_in' movements are intentionally NOT accepted here -- they're only ever
// created internally (sales finalize, returns) so every stock-out has a sale/return
// backing it instead of an unexplained manual decrement.
export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { accessory_id, movement_type, quantity_change, notes, serial_number } = body

  if (!accessory_id) return NextResponse.json({ error: 'accessory_id is required.' }, { status: 400 })
  if (!['in', 'adjustment'].includes(movement_type)) {
    return NextResponse.json({ error: "movement_type must be 'in' or 'adjustment' here." }, { status: 400 })
  }
  if (!Number.isFinite(quantity_change) || quantity_change === 0) {
    return NextResponse.json({ error: 'quantity_change must be a non-zero number.' }, { status: 400 })
  }
  if (movement_type === 'in' && quantity_change < 0) {
    return NextResponse.json({ error: "'in' movements must have a positive quantity_change." }, { status: 400 })
  }

  const { error } = await insertAccessoryMovement({
    accessoryId: accessory_id,
    movementType: movement_type,
    quantityChange: quantity_change,
    serialNumber: serial_number,
    notes,
    createdBy: sessionUser.id,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true }, { status: 201 })
}
