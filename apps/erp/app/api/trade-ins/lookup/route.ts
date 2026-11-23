import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, hasPageAccess } from '@/lib/auth/session'
import { lookupTradeInSerial } from '@/lib/trade-ins'

// ---------- GET ?serial=: what the old laptop's serial says, before taking it in ----------
// Ours (sold before -- shows when, to whom, for how much), new to us (pick its
// model), or blocked (already in stock / rented / duplicated). Selling prices
// only, never cost, so it's safe for every role that can sell.
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPageAccess(sessionUser, ['live_stock', 'new_entry', 'sales'])) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const serial = new URL(req.url).searchParams.get('serial') || ''
  const found = await lookupTradeInSerial(serial)
  if (found.kind !== 'ours') return NextResponse.json(found)
  const { trade_in_value: _cost, traded_in_at: _at, ...asset } = found.asset
  return NextResponse.json({ kind: 'ours', asset, previous_sale: found.previous_sale })
}
