import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'
import { logFieldCorrections } from '@/lib/field-corrections'

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

// ---------- PATCH: correct the vendor's invoice number / date ----------
// Owner-only. These two fields are what GSTR-2B matching and the ITC month key
// off, so a typo or an entry date saved as the bill date has to be fixable.
// Refused when either the old or new date falls in a month whose GSTR-3B is
// filed -- that month's ITC is already on the portal.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const number = String(body.invoice_number ?? '').trim()
  const date = String(body.invoice_date ?? '').trim()
  if (!number) return NextResponse.json({ error: 'Invoice number is required.' }, { status: 400 })
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: 'Invoice date is required.' }, { status: 400 })

  const { data: inv } = await supabaseAdmin.from('invoices')
    .select('id, invoice_number, invoice_date, invoice_type, po_id').eq('id', id).maybeSingle()
  if (!inv || inv.invoice_type !== 'purchase') return NextResponse.json({ error: 'Purchase invoice not found.' }, { status: 404 })
  if (inv.invoice_number === number && inv.invoice_date === date) return NextResponse.json(inv)

  let entityKey = 'digitalbluez'
  if (inv.po_id) {
    const { data: po } = await supabaseAdmin.from('purchase_orders').select('purchased_by_type').eq('id', inv.po_id).maybeSingle()
    const k = (po?.purchased_by_type || '').trim().toLowerCase()
    if (['digitalbluez', 'techtenth', 'cash'].includes(k)) entityKey = k
  }
  const months = [...new Set([inv.invoice_date, date].filter(Boolean).map((d: string) => d.slice(0, 7) + '-01'))]
  const { data: filed } = await supabaseAdmin.from('gst_filings').select('period_start')
    .eq('entity_key', entityKey).eq('return_type', 'gstr3b').eq('status', 'filed').in('period_start', months).limit(1)
  if (filed?.length) {
    return NextResponse.json({ error: `GSTR-3B for ${filed[0].period_start.slice(0, 7)} is already filed, so this invoice can't move in or out of it.` }, { status: 409 })
  }

  const { data: dup } = await supabaseAdmin.from('invoices').select('id')
    .eq('invoice_type', 'purchase').eq('invoice_number', number).neq('id', id).limit(1)
  if (dup?.length) return NextResponse.json({ error: 'Another purchase invoice already has that number.' }, { status: 409 })

  const { data, error } = await supabaseAdmin.from('invoices')
    .update({ invoice_number: number, invoice_date: date }).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const changes = [
    ...(inv.invoice_number !== number ? [{ field: 'invoice_number', oldValue: inv.invoice_number, newValue: number }] : []),
    ...(inv.invoice_date !== date ? [{ field: 'invoice_date', oldValue: inv.invoice_date, newValue: date }] : []),
  ]
  const correctionIds = await logFieldCorrections('invoices', id, changes, sessionUser!.id, 'Purchase invoice corrected')
  await logAuditEvent({
    actor: { id: sessionUser!.id, email: sessionUser!.email, role: sessionUser!.role },
    actionType: 'update', module: 'purchase_orders', tableName: 'invoices',
    recordId: id, recordLabel: number, fieldCorrectionIds: correctionIds,
  })
  return NextResponse.json(data)
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