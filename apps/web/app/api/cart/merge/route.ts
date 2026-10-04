import { NextRequest, NextResponse } from 'next/server'
import { getCustomerSession } from '@/lib/customer-session'
import { supabaseAdmin } from '@db/db/admin'
import { sortSelectedUpgrades } from '@/lib/upgrades'

// Merges a guest's localStorage cart into their account cart, once, on login.
//
// This is a deliberate exception to "the cart is plain client-direct CRUD under
// RLS, no API route" (docs/decisions.md). A client-direct merge is bounded only
// by RLS, and RLS cannot do any of the four things this has to do:
//
//   1. Re-validate every line against the live catalogue -- localStorage is
//      user-writable, so the incoming payload is hostile input.
//   2. Resolve the UNIQUE (customer_id, sku_id, selected_upgrades) conflict by
//      summing quantities rather than failing.
//   3. Normalise selected_upgrades server-side, because that constraint
//      compares jsonb and an unsorted array is a different value.
//   4. Guarantee the write lands on the caller's own cart and nobody else's.
//
// (4) is the decisive one, and it is enforced by a single rule below:
// customer_id comes from the session and is never read from the request body.

const MAX_LINES = 20
const MAX_QTY_PER_LINE = 10
const MAX_TOTAL_UNITS = 50

interface IncomingLine {
  sku_id?: unknown
  quantity?: unknown
  selected_upgrades?: unknown
}

export async function POST(req: NextRequest) {
  const session = await getCustomerSession()
  // Also the correct answer for a staff member browsing the storefront:
  // getCustomerSession() returns null for a profiles-only identity, and a
  // staff account has no cart.
  if (!session) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const incoming: IncomingLine[] = Array.isArray(body?.lines) ? body.lines : []

  if (incoming.length === 0) {
    // A replay with an empty cart is a no-op, not an error -- the client clears
    // localStorage after a successful merge, so this is the expected shape of a
    // second call.
    return NextResponse.json({ merged: 0, dropped: [] })
  }
  if (incoming.length > MAX_LINES) {
    return NextResponse.json({ error: `A cart cannot hold more than ${MAX_LINES} different items.` }, { status: 400 })
  }

  // Re-sorted here rather than trusting the client's ordering.
  const lines = incoming
    .map((l) => ({
      sku_id: typeof l.sku_id === 'string' ? l.sku_id : null,
      quantity: Number(l.quantity),
      selected_upgrades: Array.isArray(l.selected_upgrades) ? sortSelectedUpgrades(l.selected_upgrades as any) : [],
    }))
    .filter((l): l is { sku_id: string; quantity: number; selected_upgrades: any } => !!l.sku_id)

  if (lines.some((l) => !Number.isInteger(l.quantity) || l.quantity < 1 || l.quantity > MAX_QTY_PER_LINE)) {
    return NextResponse.json({ error: `Each item is limited to ${MAX_QTY_PER_LINE}.` }, { status: 400 })
  }
  const totalUnits = lines.reduce((sum, l) => sum + l.quantity, 0)
  if (totalUnits > MAX_TOTAL_UNITS) {
    return NextResponse.json({ error: `A cart cannot hold more than ${MAX_TOTAL_UNITS} units.` }, { status: 400 })
  }

  // Only published, in-stock SKUs survive. public_products is the same
  // publish-safe view the storefront reads, so an unpublished or deleted SKU is
  // simply absent from it.
  const { data: products } = await supabaseAdmin
    .from('public_products')
    .select('id, availability_bucket')
    .in('id', lines.map((l) => l.sku_id))
  const byId = new Map((products ?? []).map((p) => [p.id, p]))

  const dropped: string[] = []
  const usable = lines.filter((l) => {
    const p = byId.get(l.sku_id)
    // Dropped rather than failing the whole merge: one stale line must not cost
    // the customer the rest of their cart. Reported back so the UI can say so.
    if (!p || p.availability_bucket === 'sold_out') {
      dropped.push(l.sku_id)
      return false
    }
    return true
  })

  const { data: existingRows } = await supabaseAdmin
    .from('cart_items')
    .select('id, sku_id, quantity, selected_upgrades')
    .eq('customer_id', session.id)

  const key = (skuId: string, upgrades: unknown) => `${skuId}::${JSON.stringify(upgrades ?? [])}`
  const existingByKey = new Map(
    (existingRows ?? []).map((r) => [key(r.sku_id, sortSelectedUpgrades((r.selected_upgrades as any) ?? [])), r]),
  )

  let merged = 0
  for (const line of usable) {
    const match = existingByKey.get(key(line.sku_id, line.selected_upgrades))
    if (match) {
      // Summed, not replaced: "I had one in my account and added one as a
      // guest" should read as two. The per-line cap bounds any abuse.
      const next = Math.min(match.quantity + line.quantity, MAX_QTY_PER_LINE)
      if (next !== match.quantity) {
        await supabaseAdmin.from('cart_items').update({ quantity: next }).eq('id', match.id)
      }
    } else {
      const { error } = await supabaseAdmin.from('cart_items').insert({
        // From the session. Never from the body -- this is the line that makes
        // it impossible to aim this endpoint at another customer's cart.
        customer_id: session.id,
        sku_id: line.sku_id,
        quantity: line.quantity,
        selected_upgrades: line.selected_upgrades,
      })
      // A 23505 here means a concurrent merge already inserted the same line;
      // treat it as success rather than failing the whole request.
      if (error && error.code !== '23505') continue
    }
    merged += 1
  }

  return NextResponse.json({ merged, dropped })
}
