// Credit notes. Owner-only -- this reverses revenue that has already been
// reported, so it is money leaving the business in GST terms.
//
// A credit note is the correct remedy for a sale that has to be undone after
// its invoice went out. Voiding the sale does not retract the invoice, which is
// why /api/sales/[id]/void warns that the two will then disagree; this closes
// that gap.
//
// Amounts are stored POSITIVE, exactly like an invoice. The GSTR-1 cdnr section
// wants positives and the portal derives the reduction itself, while Table 12
// and 3B net via the view's *_signed columns.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'
import { financialYear } from '@db/shared'
import { checkPeriodLock, periodLockedResponse } from '@/lib/period-lock'

export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { data, error } = await supabaseAdmin
    .from('invoices')
    .select('*')
    .eq('invoice_type', 'credit_note')
    .eq('is_deleted', false)
    .order('invoice_date', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json().catch(() => null)
  if (!body?.invoice_id) return NextResponse.json({ error: 'invoice_id is required' }, { status: 400 })
  const reason = String(body.reason || '').trim()
  if (!reason) {
    return NextResponse.json({ error: 'A reason is required for a credit note.' }, { status: 400 })
  }

  const { data: original, error: oErr } = await supabaseAdmin
    .from('invoices').select('*').eq('id', body.invoice_id).single()
  if (oErr || !original) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
  if (original.invoice_type === 'credit_note') {
    return NextResponse.json({ error: 'You cannot credit a credit note.' }, { status: 400 })
  }
  if (!original.entity_key) {
    return NextResponse.json({ error: 'That invoice has no issuing entity, so a credit note cannot be numbered.' }, { status: 400 })
  }

  const { data: entity } = await supabaseAdmin
    .from('business_profiles').select('is_gst_registered').eq('key', original.entity_key).single()
  if (!entity?.is_gst_registered) {
    return NextResponse.json({
      error: 'That entity is not GST registered, so it issues a Bill of Supply rather than a tax invoice and has no credit note to reverse.',
    }, { status: 400 })
  }

  // One credit note per invoice. A partial reversal is a smaller credit note,
  // not a second one -- two would double-reduce the reported supply.
  const { data: existing } = await supabaseAdmin
    .from('invoices').select('id, invoice_number')
    .eq('credit_note_of_invoice_id', original.id).eq('is_deleted', false).maybeSingle()
  if (existing) {
    return NextResponse.json({
      error: `This invoice already has credit note ${existing.invoice_number}.`,
      error_code: 'already_credited',
    }, { status: 409 })
  }

  const creditDate = body.credit_note_date || new Date().toISOString().slice(0, 10)
  const lock = await checkPeriodLock('sales', creditDate, original.entity_key)
  if (lock.locked) return NextResponse.json(periodLockedResponse(lock), { status: 409 })

  const { data: originalItems, error: iErr } = await supabaseAdmin
    .from('invoice_items').select('*').eq('invoice_id', original.id)
  if (iErr) return NextResponse.json({ error: iErr.message }, { status: 500 })
  if (!originalItems?.length) {
    return NextResponse.json({ error: 'That invoice has no line items to credit.' }, { status: 400 })
  }

  // A partial credit names the lines and quantities to reverse; omitting them
  // credits the whole invoice.
  const selections: Record<string, number> | null =
    body.items && typeof body.items === 'object' ? body.items : null

  const rows = originalItems
    .map((li) => {
      const qty = selections ? Number(selections[li.id] ?? 0) : Number(li.quantity ?? 1)
      if (!(qty > 0)) return null
      if (qty > Number(li.quantity ?? 1)) {
        throw new Error(`Cannot credit ${qty} of a line that was invoiced ${li.quantity}.`)
      }
      // Tax is re-derived from the credited quantity rather than copied, so a
      // partial credit cannot carry the full invoice's tax.
      const ratio = qty / Number(li.quantity ?? 1)
      const r2 = (v: any) => Math.round((Number(v) || 0) * ratio * 100) / 100
      return {
        item_type: li.item_type,
        description: li.description,
        hsn_code: li.hsn_code,
        quantity: qty,
        rate: li.rate,
        gst_rate: li.gst_rate,
        gst_type: li.gst_type,
        cgst_amount: r2(li.cgst_amount),
        sgst_amount: r2(li.sgst_amount),
        igst_amount: r2(li.igst_amount),
        amount: Math.round(qty * Number(li.rate ?? 0) * 100) / 100,
        sku_id: li.sku_id,
        accessory_id: li.accessory_id,
        ledger_asset_id: li.ledger_asset_id,
        asset_number: li.asset_number,
        repair_job_id: li.repair_job_id,
      }
    })
    .filter(Boolean) as any[]

  if (rows.length === 0) {
    return NextResponse.json({ error: 'Nothing was selected to credit.' }, { status: 400 })
  }

  const subtotal = rows.reduce((a, r) => a + Number(r.amount), 0)
  const totalGst = rows.reduce(
    (a, r) => a + Number(r.cgst_amount) + Number(r.sgst_amount) + Number(r.igst_amount), 0)

  // Number minted only after every line has validated, so a bad request can
  // never burn a real credit-note number -- the same rule the invoice path uses.
  const { data: number, error: nErr } = await supabaseAdmin.rpc('next_document_number', {
    p_entity_key: original.entity_key,
    p_doc_type: 'credit_note',
    p_financial_year: financialYear(new Date(creditDate)),
  })
  if (nErr) return NextResponse.json({ error: `Could not assign a number: ${nErr.message}` }, { status: 500 })

  const { data: note, error: cErr } = await supabaseAdmin
    .from('invoices')
    .insert({
      invoice_number: number,
      invoice_date: creditDate,
      invoice_type: 'credit_note',
      entity_key: original.entity_key,
      credit_note_of_invoice_id: original.id,
      credit_note_reason: reason,
      customer_id: original.customer_id,
      customer_name: original.customer_name,
      customer_gst: original.customer_gst,
      customer_address: original.customer_address,
      customer_phone: original.customer_phone,
      customer_email: original.customer_email,
      place_of_supply: original.place_of_supply,
      subtotal: Math.round(subtotal * 100) / 100,
      total_gst: Math.round(totalGst * 100) / 100,
      grand_total: Math.round((subtotal + totalGst) * 100) / 100,
      total_amount: Math.round(subtotal * 100) / 100,
      gst_total: Math.round(totalGst * 100) / 100,
      status: 'approved',
      payment_status: 'pending',
      source: 'system_issued',
      created_by: sessionUser.id,
    })
    .select()
    .single()
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 })

  const { error: liErr } = await supabaseAdmin
    .from('invoice_items')
    .insert(rows.map((r) => ({ ...r, invoice_id: note.id })))
  if (liErr) {
    await supabaseAdmin.from('invoices').delete().eq('id', note.id)
    return NextResponse.json({ error: liErr.message }, { status: 500 })
  }

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'create', module: 'invoices', tableName: 'invoices',
    recordId: note.id, recordLabel: `${number} (credit note for ${original.invoice_number})`,
    metadata: {
      credited_invoice: original.invoice_number,
      reason,
      partial: !!selections,
      grand_total: note.grand_total,
    },
  })

  return NextResponse.json({ credit_note: note, lines: rows.length }, { status: 201 })
}
