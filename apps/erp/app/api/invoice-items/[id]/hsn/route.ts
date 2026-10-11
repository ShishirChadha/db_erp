// Owner-only, audited correction of one invoice line's HSN/SAC. The line's hsn_code is a snapshot
// taken from the SKU at invoicing, so editing the SKU later never repairs an existing line; this
// is the one safe path for that. A filed or locked month is frozen on purpose, like the customer
// snapshot refresh. `also_sku` additionally sets the SKU's HSN so future invoices follow.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'
import { logFieldCorrections } from '@/lib/field-corrections'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const hsn = String(body.hsn_code ?? '').trim()
  const alsoSku = body.also_sku === true
  if (!/^\d{4,8}$/.test(hsn)) {
    return NextResponse.json({ error: 'HSN/SAC must be 4 to 8 digits.' }, { status: 400 })
  }

  const { data: line } = await supabaseAdmin.from('invoice_items')
    .select('id, invoice_id, hsn_code, sku_id, accessory_id, description').eq('id', id).maybeSingle()
  if (!line) return NextResponse.json({ error: 'Invoice line not found.' }, { status: 404 })
  const { data: inv } = await supabaseAdmin.from('invoices')
    .select('invoice_number, invoice_date, entity_key').eq('id', line.invoice_id).maybeSingle()
  if (!inv) return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 })

  const month = String(inv.invoice_date).slice(0, 7) + '-01'
  const [{ data: locked }, { data: filed }] = await Promise.all([
    supabaseAdmin.rpc('is_period_locked', { p_entity_key: inv.entity_key, p_module: 'sales', p_txn_date: inv.invoice_date }),
    supabaseAdmin.from('gst_filings').select('id').eq('entity_key', inv.entity_key).eq('return_type', 'gstr1')
      .eq('status', 'filed').eq('period_start', month).limit(1),
  ])
  if (locked || (filed && filed.length)) {
    return NextResponse.json({ error: 'That month is filed or locked, so the invoice line is frozen.' }, { status: 409 })
  }

  const { error } = await supabaseAdmin.from('invoice_items').update({ hsn_code: hsn }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  await logFieldCorrections('invoice_items', id, [{ field: 'hsn_code', oldValue: line.hsn_code, newValue: hsn }],
    sessionUser.id, `HSN corrected on ${inv.invoice_number}`)

  let skuUpdated = false
  const skuId = line.sku_id || line.accessory_id
  if (alsoSku && skuId) {
    const { data: sku } = await supabaseAdmin.from('sku_master').select('hsn_code').eq('id', skuId).maybeSingle()
    if (sku && sku.hsn_code !== hsn) {
      const { error: skuErr } = await supabaseAdmin.from('sku_master').update({ hsn_code: hsn }).eq('id', skuId)
      if (skuErr) return NextResponse.json({ error: `Line updated, but the SKU could not be: ${skuErr.message}` }, { status: 500 })
      await logFieldCorrections('sku_master', skuId, [{ field: 'hsn_code', oldValue: sku.hsn_code, newValue: hsn }],
        sessionUser.id, `HSN set while correcting ${inv.invoice_number}`)
      skuUpdated = true
    }
  }

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'update', module: 'gst', tableName: 'invoice_items', recordId: id, recordLabel: inv.invoice_number,
    metadata: { hsn_before: line.hsn_code, hsn_after: hsn, sku_updated: skuUpdated },
  })
  return NextResponse.json({ success: true, sku_updated: skuUpdated })
}
