import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'

// ---------- GET: list RMA events ----------
// Owner-only -- to_vendor rows join vendor company names, which employees never see.
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const direction = searchParams.get('direction')
  const status = searchParams.get('status')

  let query = supabaseAdmin
    .from('asset_rma_events')
    .select(`
      id, asset_id, direction, reason, vendor_id, status, opened_at, closed_at, notes,
      asset_ledger ( asset_number, serial_number, status ),
      vendors ( company_name )
    `)
    .order('opened_at', { ascending: false })

  if (direction) query = query.eq('direction', direction)
  if (status) query = query.eq('status', status)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  return NextResponse.json(data)
}

// ---------- POST: open an RMA (vendor return or customer return) ----------
export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = { id: sessionUser.id }

  const body = await req.json()
  const { asset_id, direction, reason, vendor_id, notes, event_date } = body

  if (!asset_id || !direction || !reason) {
    return NextResponse.json({ error: 'asset_id, direction, and reason are required' }, { status: 400 })
  }
  if (!['to_vendor', 'from_customer'].includes(direction)) {
    return NextResponse.json({ error: 'direction must be to_vendor or from_customer' }, { status: 400 })
  }
  if (event_date && !/^\d{4}-\d{2}-\d{2}$/.test(event_date)) {
    return NextResponse.json({ error: 'event_date must be in YYYY-MM-DD format.' }, { status: 400 })
  }
  // Vendor returns are owner-only -- they involve vendor_id, which employees never see.
  if (direction === 'to_vendor' && !isOwner(sessionUser)) {
    return NextResponse.json({ error: 'Only the owner can send a unit back to a vendor.' }, { status: 403 })
  }

  const { data: asset } = await supabaseAdmin
    .from('asset_ledger')
    .select('status, sku_id')
    .eq('id', asset_id)
    .single()

  if (!asset) return NextResponse.json({ error: 'Asset not found' }, { status: 404 })

  // A vendor return is for stock that failed QC and never reached a customer; a
  // customer return is for a unit that was actually sold.
  if (direction === 'to_vendor' && asset.status !== 'faulty') {
    return NextResponse.json(
      { error: `Only 'faulty' assets can be sent back to a vendor (current status: ${asset.status})` },
      { status: 400 }
    )
  }
  if (direction === 'from_customer' && asset.status !== 'sold') {
    return NextResponse.json(
      { error: `Only 'sold' assets can have a customer return (current status: ${asset.status})` },
      { status: 400 }
    )
  }

  // Backdate support: an employee logging a return that actually happened earlier can
  // supply event_date; defaults to "now" (matches opened_at's DB default) if omitted.
  const openedAt = event_date ? `${event_date}T12:00:00.000Z` : undefined

  const { data: event, error: insertErr } = await supabaseAdmin
    .from('asset_rma_events')
    .insert({
      asset_id,
      direction,
      reason,
      vendor_id: direction === 'to_vendor' ? vendor_id || null : null,
      notes: notes || null,
      created_by: user.id,
      ...(openedAt ? { opened_at: openedAt } : {}),
    })
    .select()
    .single()

  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 })

  // to_vendor: unit leaves the building, pending vendor resolution.
  // from_customer: unit re-enters the QC funnel exactly like a fresh receipt, since it
  // needs to be re-inspected before it can be resold or sent back to the vendor itself.
  const newAssetStatus = direction === 'to_vendor' ? 'rma_sent' : 'qc_pending'
  const updates: Record<string, any> = { status: newAssetStatus }
  if (direction === 'from_customer') updates.qc_status = 'pending'

  await supabaseAdmin.from('asset_ledger').update(updates).eq('id', asset_id)

  // The original sale wrote a -1 'sale' movement (app/api/sales-entry/route.ts) that
  // nothing downstream ever offsets -- without this, sku_master.quantity_in_stock
  // (trigger-maintained off stock_movements) permanently understates stock by 1 every
  // time a customer returns a unit. Same 'adjustment' idiom used elsewhere in the app.
  if (direction === 'from_customer' && asset.sku_id) {
    await supabaseAdmin.from('stock_movements').insert({
      sku_id: asset.sku_id,
      movement_type: 'adjustment',
      quantity_change: 1,
      notes: `Customer return -- ${reason}`,
      created_by: user.id,
    })
  }

  return NextResponse.json(event, { status: 201 })
}
