import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner, canEditPage } from '@/lib/auth/session'
import { logFieldCorrections } from '@/lib/field-corrections'
import { logAuditEvent } from '@/lib/audit-log'

// ---------- POST: apply the same E-way Bill number/date to several sales at once ----------
// Mirrors the existing multi-row Zoho invoice-number tool (RecordZohoInvoiceDialog /
// /api/sales/record-external-invoice) -- several sales filed under one invoice number
// physically travel on one E-way Bill too, so setting it per-row one at a time is pure
// busywork. Works regardless of finalized/invoice_mode (an E-way Bill is set per
// shipment, not per invoicing path), unlike the combined-invoice tools which require an
// un-finalized, non-voided, single-entity selection.
export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isOwner(sessionUser) && !canEditPage(sessionUser, 'live_stock') && !canEditPage(sessionUser, 'sales') && !canEditPage(sessionUser, 'stock')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const saleIds: string[] = Array.isArray(body.sale_ids) ? body.sale_ids : []
  const ewayBillNumber: string | null = (body.eway_bill_number || '').trim() || null
  const ewayBillDate: string | null = body.eway_bill_date || null

  if (saleIds.length === 0) return NextResponse.json({ error: 'Provide at least one sale_id.' }, { status: 400 })
  if (!ewayBillNumber && !ewayBillDate) {
    return NextResponse.json({ error: 'Enter an E-way Bill number or date.' }, { status: 400 })
  }

  const { data: sales, error: salesErr } = await supabaseAdmin
    .from('sales')
    .select('id, eway_bill_number, eway_bill_date, is_deleted, invoice_number')
    .in('id', saleIds)
  if (salesErr) return NextResponse.json({ error: salesErr.message }, { status: 500 })
  if (!sales || sales.length !== saleIds.length) {
    return NextResponse.json({ error: 'One or more sales were not found.' }, { status: 404 })
  }
  if (sales.some((s) => s.is_deleted)) {
    return NextResponse.json({ error: 'One or more of these sales were voided and cannot be edited.' }, { status: 400 })
  }

  const { error: updateErr } = await supabaseAdmin
    .from('sales')
    .update({ eway_bill_number: ewayBillNumber, eway_bill_date: ewayBillDate })
    .in('id', saleIds)
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

  for (const s of sales) {
    const fieldCorrectionIds = await logFieldCorrections(
      'sales',
      s.id,
      [
        { field: 'eway_bill_number', oldValue: s.eway_bill_number, newValue: ewayBillNumber },
        { field: 'eway_bill_date', oldValue: s.eway_bill_date, newValue: ewayBillDate },
      ],
      sessionUser.id,
      `Bulk E-way Bill update across ${saleIds.length} sale${saleIds.length > 1 ? 's' : ''}`
    )
    await logAuditEvent({
      actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
      actionType: 'update',
      module: 'sales',
      tableName: 'sales',
      recordId: s.id,
      recordLabel: s.invoice_number || s.id,
      fieldCorrectionIds,
      reason: `Bulk E-way Bill update across ${saleIds.length} sale${saleIds.length > 1 ? 's' : ''}`,
    })
  }

  return NextResponse.json({ success: true, updated: sales.length })
}
