import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner, hasPageAccess, canEditPage } from '@/lib/auth/session'
import { closeAccessoryRma } from '@/lib/accessory-rma'
import { logAuditEvent } from '@/lib/audit-log'

// ---------- GET: accessory RMA event detail ----------
// Same non-owner scoping as GET /api/accessory-rma -- from_customer only, no vendor identity.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser(req)
  if (!hasPageAccess(sessionUser, 'rma')) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const ownerCaller = isOwner(sessionUser)

  const { data, error } = await supabaseAdmin
    .from('accessory_rma_events')
    .select(
      ownerCaller
        ? `id, sku_id, quantity, direction, reason, vendor_id, status, opened_at, closed_at, notes,
           sku_master ( full_sku_code, sku_description, category ),
           vendors ( company_name )`
        : `id, sku_id, quantity, direction, reason, status, opened_at, closed_at, notes,
           sku_master ( full_sku_code, sku_description, category )`
    )
    .eq('id', id)
    .single()

  if (error || !data) return NextResponse.json({ error: 'Accessory RMA event not found' }, { status: 404 })
  if (!ownerCaller && (data as any).direction !== 'from_customer') {
    return NextResponse.json({ error: 'Accessory RMA event not found' }, { status: 404 })
  }
  return NextResponse.json(data)
}

// ---------- PATCH: advance status / close it ----------
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const ownerCaller = isOwner(sessionUser)
  if (!ownerCaller && !canEditPage(sessionUser, 'rma')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const { data: event } = await supabaseAdmin.from('accessory_rma_events').select('id, direction').eq('id', id).single()
  if (!event) return NextResponse.json({ error: 'Accessory RMA event not found' }, { status: 404 })
  if (!ownerCaller && event.direction !== 'from_customer') {
    return NextResponse.json({ error: 'Accessory RMA event not found' }, { status: 404 })
  }

  const body = await req.json()
  const { status, notes } = body as { status: string; notes?: string }
  if (!status) return NextResponse.json({ error: 'status is required' }, { status: 400 })

  const result = await closeAccessoryRma(id, status, { notes, userId: sessionUser.id })
  if (result.error) return NextResponse.json({ error: result.error }, { status: result.status || 500 })

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'status_change',
    module: 'rma',
    tableName: 'accessory_rma_events',
    recordId: id,
    recordLabel: status,
  })

  return NextResponse.json({ success: true, status })
}
