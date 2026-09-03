import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'

// ---------- GET (detail) ----------
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params

  // Get invoice
  const { data: invoice, error: invErr } = await supabaseAdmin
    .from('invoices')
    .select('*')
    .eq('id', id)
    .single()

  if (invErr || !invoice) {
    return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
  }

  // Get linked PO (header)
  let po = null
  if (invoice.po_id) {
    const { data: poData } = await supabaseAdmin
      .from('purchase_orders')
      .select('id, po_number, po_date, vendor_name, purchased_by_type, po_status, amount_paid, payment_status, grand_total')
      .eq('id', invoice.po_id)
      .single()
    po = poData || null
  }

  // Get PO items with asset mappings
  let poItems: any[] = []
  if (invoice.po_id) {
    const { data: items } = await supabaseAdmin
      .from('purchase_order_items')
      .select('*')
      .eq('po_id', invoice.po_id)
      .order('line_item_number', { ascending: true })

    if (items) {
      poItems = await Promise.all(
        items.map(async (item: any) => {
          const { data: sku } = await supabaseAdmin
            .from('sku_master')
            .select('full_sku_code, sku_description')
            .eq('id', item.sku_id)
            .single()

          const { data: assets } = await supabaseAdmin
            .from('asset_ledger')
            .select('asset_number, serial_number, status')
            .eq('po_item_id', item.id)

          return {
            ...item,
            sku_code: sku?.full_sku_code || item.base_sku_code,
            sku_desc: sku?.sku_description || '',
            assets: assets || [],
          }
        })
      )
    }
  }

  return NextResponse.json({
    ...invoice,
    purchase_order: po,
    po_items: poItems,
  })
}

// ---------- DELETE (permanent) ----------
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params

  // 1. Get invoice to know its PO
  const { data: invoice } = await supabaseAdmin
    .from('invoices')
    .select('*')
    .eq('id', id)
    .single()

  // 2. Delete the invoice
  const { error } = await supabaseAdmin
    .from('invoices')
    .delete()
    .eq('id', id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // 3. If this invoice was linked to a PO, revert PO status based on the PO's actual
  // receiving progress — not a hardcoded 'received'. An invoice can be created while a
  // PO is still 'submitted' (nothing received yet) or 'partially_received', so deleting
  // it must not silently advance the PO past where receiving actually stands.
  if (invoice?.po_id) {
    const { data: items } = await supabaseAdmin
      .from('purchase_order_items')
      .select('quantity, serial_numbers')
      .eq('po_id', invoice.po_id)

    const allFullyReceived = (items ?? []).length > 0 && (items ?? []).every(
      (item) => (item.serial_numbers?.length || 0) >= item.quantity
    )
    const anyReceived = (items ?? []).some((item) => (item.serial_numbers?.length || 0) > 0)

    const revertedStatus = allFullyReceived ? 'received' : anyReceived ? 'partially_received' : 'submitted'

    await supabaseAdmin
      .from('purchase_orders')
      .update({ po_status: revertedStatus })
      .eq('id', invoice.po_id)
  }

  // This is a genuine hard delete (no is_deleted flag on `invoices` for this route,
  // unlike the PO soft-delete above) -- no restore handler exists for it yet in
  // lib/audit-log-restore.ts, so restoreStatus stays 'not_applicable'; the snapshot
  // is still captured for audit-trail visibility.
  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'hard_delete',
    module: 'purchase_orders',
    tableName: 'invoices',
    recordId: id,
    recordLabel: invoice?.invoice_number || id,
    snapshot: { kind: 'row', table: 'invoices', row: invoice },
    restoreStatus: 'not_applicable',
  })

  return NextResponse.json({ success: true })
}