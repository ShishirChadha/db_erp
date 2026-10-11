// Owner-only: split an add-on that was sold inside a unit's invoice line out into its own line, so the
// ERP invoice mirrors the Zoho invoice where the add-on was billed separately with its own HSN.
// The invoice's taxable value, tax and total are unchanged -- the add-on's amount (and its share of tax at
// the same rate) moves from the unit line to the new line. Refused for a filed or locked month.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'
import { logFieldCorrections } from '@/lib/field-corrections'

const r2 = (n: number) => Math.round(n * 100) / 100

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const amount = r2(Number(body.amount))
  const hsn = String(body.hsn_code ?? '').trim()
  const description = String(body.description ?? '').replace(/\s+/g, ' ').trim()
  const accessoryId: string | null = body.accessory_id ? String(body.accessory_id) : null
  if (!(amount > 0)) return NextResponse.json({ error: 'Enter the amount before GST that moves to the new line.' }, { status: 400 })
  if (!/^\d{4,8}$/.test(hsn)) return NextResponse.json({ error: 'HSN/SAC must be 4 to 8 digits.' }, { status: 400 })
  if (!description) return NextResponse.json({ error: 'A description is required.' }, { status: 400 })

  const { data: line } = await supabaseAdmin.from('invoice_items').select('*').eq('id', id).maybeSingle()
  if (!line) return NextResponse.json({ error: 'Invoice line not found.' }, { status: 404 })
  const { data: inv } = await supabaseAdmin.from('invoices')
    .select('invoice_number, invoice_date, entity_key').eq('id', line.invoice_id).maybeSingle()
  if (!inv) return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 })

  if (Number(line.quantity) !== 1) return NextResponse.json({ error: 'Only a single-quantity line can be split.' }, { status: 400 })
  if (line.bundled_into_item_id) return NextResponse.json({ error: 'This line is bundled into another line; unbundle it first.' }, { status: 400 })
  const parentTaxable = r2(Number(line.rate))
  if (amount >= parentTaxable) return NextResponse.json({ error: `The amount must be less than the line's ₹${parentTaxable} before GST.` }, { status: 400 })

  const month = String(inv.invoice_date).slice(0, 7) + '-01'
  const [{ data: locked }, { data: filed }] = await Promise.all([
    supabaseAdmin.rpc('is_period_locked', { p_entity_key: inv.entity_key, p_module: 'sales', p_txn_date: inv.invoice_date }),
    supabaseAdmin.from('gst_filings').select('id').eq('entity_key', inv.entity_key).eq('return_type', 'gstr1')
      .eq('status', 'filed').eq('period_start', month).limit(1),
  ])
  if (locked || (filed && filed.length)) {
    return NextResponse.json({ error: 'That month is filed or locked, so the invoice line is frozen.' }, { status: 409 })
  }
  if (accessoryId) {
    const { data: sku } = await supabaseAdmin.from('sku_master').select('id').eq('id', accessoryId).maybeSingle()
    if (!sku) return NextResponse.json({ error: 'Accessory not found.' }, { status: 400 })
    // A repeat click (or a second tab) must not split the same add-on off twice.
    const { count: already } = await supabaseAdmin.from('invoice_items').select('id', { count: 'exact', head: true })
      .eq('invoice_id', line.invoice_id).eq('accessory_id', accessoryId).is('sale_id', null)
    if (already) return NextResponse.json({ error: 'That add-on is already split off on this invoice.' }, { status: 409 })
  }

  // Same rate and tax type as the unit line, so no GST changes character -- only which HSN row it sits in.
  const rate = Number(line.gst_rate)
  const newTax = r2(amount * rate / 100)
  const isIgst = Number(line.igst_amount) > 0
  const newCgst = isIgst ? 0 : r2(newTax / 2)
  const newSgst = isIgst ? 0 : r2(newTax - newCgst)
  const newIgst = isIgst ? newTax : 0
  const oldTax = Number(line.cgst_amount) + Number(line.sgst_amount) + Number(line.igst_amount)
  if (newTax > oldTax) return NextResponse.json({ error: 'That amount carries more tax than the line has.' }, { status: 400 })

  const parentCgst = r2(Number(line.cgst_amount) - newCgst)
  const parentSgst = r2(Number(line.sgst_amount) - newSgst)
  const parentIgst = r2(Number(line.igst_amount) - newIgst)
  const parentRate = r2(parentTaxable - amount)
  const parentAmount = r2(parentRate + parentCgst + parentSgst + parentIgst)

  const { data: created, error: insErr } = await supabaseAdmin.from('invoice_items').insert({
    invoice_id: line.invoice_id, item_type: 'accessory', accessory_id: accessoryId, description, hsn_code: hsn,
    quantity: 1, rate: amount, gst_rate: rate, gst_type: line.gst_type,
    cgst_amount: newCgst, sgst_amount: newSgst, igst_amount: newIgst, amount: r2(amount + newTax),
  }).select('id').single()
  if (insErr || !created) return NextResponse.json({ error: insErr?.message || 'Could not add the new line.' }, { status: 500 })

  const { error: upErr } = await supabaseAdmin.from('invoice_items').update({
    rate: parentRate, cgst_amount: parentCgst, sgst_amount: parentSgst, igst_amount: parentIgst, amount: parentAmount,
  }).eq('id', id)
  if (upErr) {
    await supabaseAdmin.from('invoice_items').delete().eq('id', created.id)
    return NextResponse.json({ error: upErr.message }, { status: 500 })
  }

  await logFieldCorrections('invoice_items', id, [
    { field: 'rate', oldValue: line.rate, newValue: parentRate },
    { field: 'cgst_amount', oldValue: line.cgst_amount, newValue: parentCgst },
    { field: 'sgst_amount', oldValue: line.sgst_amount, newValue: parentSgst },
    { field: 'igst_amount', oldValue: line.igst_amount, newValue: parentIgst },
    { field: 'amount', oldValue: line.amount, newValue: parentAmount },
  ], sessionUser.id, `Split "${description}" (₹${amount}, HSN ${hsn}) off ${inv.invoice_number}`)
  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'update', module: 'gst', tableName: 'invoice_items', recordId: id, recordLabel: inv.invoice_number,
    metadata: { split_off: { new_line_id: created.id, description, hsn, taxable: amount, tax: newTax }, parent_rate_before: line.rate, parent_rate_after: parentRate },
  })
  return NextResponse.json({ success: true, new_line_id: created.id })
}
