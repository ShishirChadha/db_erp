import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner, hasPageAccess, canEditPage } from '@/lib/auth/session'
import { processAccessoryFromCustomer, processAccessoryToVendor } from '@/lib/accessory-rma'
import { logAuditEvent } from '@/lib/audit-log'

// ---------- GET: list accessory RMA events ----------
// Same non-owner scoping as GET /api/rma -- a to_vendor row joins vendor_id, which
// employees never see (CLAUDE.md: cost/vendor identity is owner-only everywhere).
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!hasPageAccess(sessionUser, 'rma')) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  const ownerCaller = isOwner(sessionUser)
  const direction = ownerCaller ? searchParams.get('direction') : 'from_customer'

  let query = supabaseAdmin
    .from('accessory_rma_events')
    .select(
      ownerCaller
        ? `id, sku_id, quantity, direction, reason, vendor_id, status, opened_at, closed_at, notes,
           sku_master ( full_sku_code, sku_description, category ),
           vendors ( company_name )`
        : `id, sku_id, quantity, direction, reason, status, opened_at, closed_at, notes,
           sku_master ( full_sku_code, sku_description, category )`
    )
    .order('opened_at', { ascending: false })

  if (direction) query = query.eq('direction', direction)
  if (status) query = query.eq('status', status)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  return NextResponse.json(data)
}

// ---------- POST: open an accessory RMA (vendor return or customer return) ----------
export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isOwner(sessionUser) && !canEditPage(sessionUser, 'rma')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const body = await req.json()
  const { sku_id, quantity, direction, reason, vendor_id, notes, event_date } = body

  if (!sku_id || !quantity || !direction || !reason) {
    return NextResponse.json({ error: 'sku_id, quantity, direction, and reason are required' }, { status: 400 })
  }
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return NextResponse.json({ error: 'quantity must be a positive number.' }, { status: 400 })
  }
  if (!['to_vendor', 'from_customer'].includes(direction)) {
    return NextResponse.json({ error: 'direction must be to_vendor or from_customer' }, { status: 400 })
  }
  if (event_date && !/^\d{4}-\d{2}-\d{2}$/.test(event_date)) {
    return NextResponse.json({ error: 'event_date must be in YYYY-MM-DD format.' }, { status: 400 })
  }
  // Vendor returns are owner-only -- they involve vendor_id, which employees never see.
  if (direction === 'to_vendor' && !isOwner(sessionUser)) {
    return NextResponse.json({ error: 'Only the owner can send accessory stock back to a vendor.' }, { status: 403 })
  }

  let result
  if (direction === 'from_customer') {
    result = await processAccessoryFromCustomer(sku_id, quantity, { reason, notes, userId: sessionUser.id, eventDate: event_date })
  } else {
    if (!vendor_id) return NextResponse.json({ error: 'vendor_id is required for a vendor return.' }, { status: 400 })
    const { data: vendor } = await supabaseAdmin.from('vendors').select('id').eq('id', vendor_id).eq('is_deleted', false).maybeSingle()
    if (!vendor) return NextResponse.json({ error: 'Selected vendor was not found.' }, { status: 400 })
    result = await processAccessoryToVendor(sku_id, quantity, { reason, vendorId: vendor_id, notes, userId: sessionUser.id, eventDate: event_date })
  }

  if (result.error) return NextResponse.json({ error: result.error }, { status: result.status || 500 })

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'create',
    module: 'rma',
    tableName: 'accessory_rma_events',
    recordId: result.event.id,
    recordLabel: result.event.id,
  })

  return NextResponse.json(result.event, { status: 201 })
}
