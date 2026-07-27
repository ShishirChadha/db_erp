import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { getLastVendorsBySku } from '@/lib/purchase-utils'

// ---------- GET: most recent vendor per SKU, for a given list of ids ----------
// Owner-only (vendor is cost-adjacent data, redacted for employees everywhere else).
// Small and deliberately separate from GET /api/sku-master itself -- that route serves
// every role and every category; this is only ever called by the owner-facing
// Accessories page, for whatever page of SKUs it's currently showing (including
// zero-stock/archived rows /api/stock/accessories intentionally excludes).
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const ids = (searchParams.get('ids') || '').split(',').map((s) => s.trim()).filter(Boolean)
  if (ids.length === 0) return NextResponse.json({})

  const map = await getLastVendorsBySku(ids)
  return NextResponse.json(Object.fromEntries(map))
}
