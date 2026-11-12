import { supabaseAdmin } from './supabase/service'

// Changes an issued invoice's place of supply and re-splits each line's tax between
// CGST+SGST (same state as the entity) and IGST (any other state). Total tax,
// taxable value and grand total never change -- only the head moves -- so this is
// safe on an approved invoice. Refused once the invoice's month is filed.
// Used by the invoice page's Place of Supply edit and GST step 5's "Use Zoho's state".
export async function applyPlaceOfSupply(invoiceId: string, pos: string):
  Promise<{ ok: true; from: string | null } | { ok: false; status: number; message: string }> {
  if (!/^\d{2}$/.test(pos)) return { ok: false, status: 400, message: 'Place of supply must be a 2-digit state code.' }

  const { data: inv } = await supabaseAdmin
    .from('invoices').select('id, invoice_date, entity_key, place_of_supply').eq('id', invoiceId).single()
  if (!inv) return { ok: false, status: 404, message: 'Invoice not found.' }

  const { data: filed } = await supabaseAdmin
    .from('gst_filings').select('id').eq('entity_key', inv.entity_key).eq('status', 'filed')
    .lte('period_start', inv.invoice_date).gte('period_end', inv.invoice_date).limit(1)
  if (filed?.length) return { ok: false, status: 409, message: 'That month is already filed -- the invoice cannot change.' }

  const { data: entity } = await supabaseAdmin
    .from('business_profiles').select('state_code').eq('key', inv.entity_key).single()
  const intra = !!entity?.state_code && entity.state_code === pos

  const { data: items } = await supabaseAdmin
    .from('invoice_items').select('id, cgst_amount, sgst_amount, igst_amount').eq('invoice_id', inv.id)
  for (const it of items ?? []) {
    const tax = (Number(it.cgst_amount) || 0) + (Number(it.sgst_amount) || 0) + (Number(it.igst_amount) || 0)
    if (tax === 0) continue
    const half = Math.round((tax / 2) * 100) / 100
    const patch = intra
      ? { gst_type: 'CGST_SGST', cgst_amount: half, sgst_amount: Math.round((tax - half) * 100) / 100, igst_amount: 0 }
      : { gst_type: 'IGST', cgst_amount: 0, sgst_amount: 0, igst_amount: Math.round(tax * 100) / 100 }
    const { error } = await supabaseAdmin.from('invoice_items').update(patch).eq('id', it.id)
    if (error) return { ok: false, status: 500, message: error.message }
  }
  const { error } = await supabaseAdmin.from('invoices').update({ place_of_supply: pos }).eq('id', inv.id)
  if (error) return { ok: false, status: 500, message: error.message }
  return { ok: true, from: inv.place_of_supply }
}
