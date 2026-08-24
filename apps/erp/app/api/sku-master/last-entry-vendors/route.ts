import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, hasPageAccess } from '@/lib/auth/session'
import { getLastEntryVendorsBySku } from '@/lib/accessory-movements'

// ---------- GET: most recent employee-entered receipt vendor + price per SKU ----------
// Unlike /api/sku-master/last-vendors (owner-only, sourced from formal PO items), this is
// the informal reference layer captured optionally by whoever received the stock -- open
// to any role with accessories/new_entry access, per docs/decisions.md.
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPageAccess(sessionUser, ['accessories', 'new_entry', 'sku_master'])) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const ids = (searchParams.get('ids') || '').split(',').map((s) => s.trim()).filter(Boolean)
  if (ids.length === 0) return NextResponse.json({})

  const map = await getLastEntryVendorsBySku(ids)
  return NextResponse.json(
    Object.fromEntries(
      [...map].map(([skuId, v]) => [
        skuId,
        { vendor_id: v.vendorId, vendor_name: v.vendorName, unit_price: v.unitPrice, purchase_date: v.purchaseDate },
      ])
    )
  )
}
