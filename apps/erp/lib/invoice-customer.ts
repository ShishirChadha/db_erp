import { supabaseAdmin } from './supabase/service'
import { applyPlaceOfSupply } from './gst-place-of-supply'

// Moving an invoiced sale to a different customer. The invoice keeps its own copy
// of the customer (name, GSTIN, address...), so changing the sale alone leaves the
// invoice billed to the old customer -- DBI2026/27-00623 stayed under "Gaurav"
// after all three of its sales were reassigned to Moptra (2026-11-13).
//
// The invoice follows only when every live sale on it ends up with the new
// customer (an invoice has exactly one customer), the user is the owner (invoice
// changes are owner-only everywhere else), and the month is neither filed nor
// locked -- same freeze rule as /api/gst/refresh-invoice-customer.

export interface InvoiceMoveCheck {
  invoice_id: string
  invoice_number: string | null
  invoice_customer_name: string | null
  /** The invoice is already billed to the new customer -- nothing to ask. */
  already_matches: boolean
  can_move: boolean
  /** Why the invoice can't follow the sale, when can_move is false. */
  reason: string | null
}

export async function checkInvoiceCustomerMove(
  invoiceId: string,
  saleId: string,
  newCustomerId: string | null,
  ownerUser: boolean,
): Promise<InvoiceMoveCheck> {
  const { data: inv } = await supabaseAdmin
    .from('invoices')
    .select('id, invoice_number, invoice_date, entity_key, customer_id, customer_name')
    .eq('id', invoiceId)
    .maybeSingle()
  const base = {
    invoice_id: invoiceId,
    invoice_number: inv?.invoice_number ?? null,
    invoice_customer_name: inv?.customer_name ?? null,
  }
  if (!inv) return { ...base, already_matches: false, can_move: false, reason: 'The invoice record was not found.' }
  if (inv.customer_id && inv.customer_id === newCustomerId) return { ...base, already_matches: true, can_move: false, reason: null }
  if (!newCustomerId) return { ...base, already_matches: false, can_move: false, reason: 'An invoice needs a customer.' }

  const { data: others } = await supabaseAdmin
    .from('sales')
    .select('id, customer_id')
    .eq('invoice_id', invoiceId)
    .eq('is_deleted', false)
    .neq('id', saleId)
  const stillOld = (others || []).filter((s) => s.customer_id !== newCustomerId).length
  if (stillOld > 0) {
    return {
      ...base, already_matches: false, can_move: false,
      reason: `${stillOld} other sale${stillOld === 1 ? '' : 's'} on this invoice still belong${stillOld === 1 ? 's' : ''} to ${inv.customer_name || 'the old customer'}. Change ${stillOld === 1 ? 'it' : 'them'} too, and the last one will offer to move the invoice.`,
    }
  }
  if (!ownerUser) {
    return { ...base, already_matches: false, can_move: false, reason: "Only the owner can change an invoice's customer." }
  }

  const month = String(inv.invoice_date).slice(0, 7) + '-01'
  const [{ data: locked }, { data: filed }] = await Promise.all([
    supabaseAdmin.rpc('is_period_locked', { p_entity_key: inv.entity_key, p_module: 'sales', p_txn_date: inv.invoice_date }),
    supabaseAdmin.from('gst_filings').select('id').eq('entity_key', inv.entity_key).eq('return_type', 'gstr1')
      .eq('status', 'filed').eq('period_start', month).limit(1),
  ])
  if (filed && filed.length) {
    return { ...base, already_matches: false, can_move: false, reason: "The invoice's month is already filed, so the invoice is frozen." }
  }
  if (locked) {
    return {
      ...base, already_matches: false, can_move: false,
      reason: "The invoice's month is locked. Unlock a window for it in GST settings first, then save again.",
    }
  }
  return { ...base, already_matches: false, can_move: true, reason: null }
}

// Re-snapshots the invoice's customer block from the customer record (the same
// fields invoice-finalize copies at creation) and, when the new customer is in a
// different state, moves the place of supply -- which re-splits CGST+SGST vs IGST
// without changing any total. Call only after checkInvoiceCustomerMove said yes.
export async function moveInvoiceToCustomer(invoiceId: string, customerId: string) {
  const [{ data: inv }, { data: customer }] = await Promise.all([
    supabaseAdmin.from('invoices')
      .select('entity_key, place_of_supply, customer_id, customer_name, customer_gst, customer_address, shipping_address, customer_phone, customer_email')
      .eq('id', invoiceId).single(),
    supabaseAdmin.from('customers')
      .select('customer_name, gst_number, address, shipping_address, phone, email, state_code')
      .eq('id', customerId).single(),
  ])
  if (!inv || !customer) return { ok: false as const, message: 'Invoice or customer not found.' }

  const after = {
    customer_id: customerId,
    customer_name: customer.customer_name?.trim() || null,
    customer_gst: customer.gst_number?.trim() || null,
    customer_address: customer.address || null,
    shipping_address: customer.shipping_address || null,
    customer_phone: customer.phone || null,
    customer_email: customer.email || null,
  }
  const { error } = await supabaseAdmin.from('invoices').update(after).eq('id', invoiceId)
  if (error) return { ok: false as const, message: error.message }

  // Same place-of-supply rule as invoice-finalize's classifyGst.
  const { data: entity } = await supabaseAdmin.from('business_profiles').select('state_code').eq('key', inv.entity_key).single()
  const pos = after.customer_gst?.slice(0, 2) || customer.state_code || entity?.state_code || null
  let placeOfSupply: { from: string | null; to: string } | null = null
  if (pos && pos !== inv.place_of_supply) {
    const res = await applyPlaceOfSupply(invoiceId, pos)
    if (!res.ok) return { ok: false as const, message: `Customer moved, but the place of supply could not change: ${res.message}` }
    placeOfSupply = { from: res.from, to: pos }
  }

  const { entity_key: _e, place_of_supply: _p, ...before } = inv
  return { ok: true as const, before, after, placeOfSupply }
}
