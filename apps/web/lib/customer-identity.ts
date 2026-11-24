import { supabaseAdmin } from '@db/db/admin'

export interface CustomerMatch {
  customerId: string
  reusedExisting: boolean
}

// The ERP treats a phone number as one customer unless the records carry
// different GSTINs (customers_active_phone_gst_unique) -- an existing walk-in/in-store customer
// signing up on the website (or completing a guest order) with the same
// phone should link to that existing record, reuniting their store + web
// history, rather than fail because the phone is "already taken" or create
// a second, disconnected record.
//
// Extracted out of POST /api/auth/signup (which now calls this) so the guest
// -checkout webhook (apps/web/lib/order-to-sale.ts) can reuse the exact same
// dedupe logic instead of a second, drifting copy.
export async function findOrCreateCustomerByPhone(opts: {
  fullName: string
  phone: string | null
  email: string | null
}): Promise<{ ok: true; match: CustomerMatch } | { ok: false; error: string }> {
  const trimmedPhone = (opts.phone || '').trim()

  if (trimmedPhone) {
    // Several companies can share one mobile (different GSTINs), so this can
    // match more than one row: prefer the person's own record (no GSTIN), else
    // the oldest. Never .maybeSingle() here -- it errors on two rows, which
    // would fall through and create yet another record.
    const { data: matches } = await supabaseAdmin
      .from('customers')
      .select('id, gst_number')
      .eq('is_deleted', false)
      .eq('phone', trimmedPhone)
      .order('created_at', { ascending: true })
      .limit(20)
    const existing = (matches || []).find((m) => !(m.gst_number || '').trim()) || (matches || [])[0]
    if (existing) return { ok: true, match: { customerId: existing.id, reusedExisting: true } }
  }

  const { data: created, error } = await supabaseAdmin
    .from('customers')
    .insert({
      customer_name: opts.fullName,
      type: 'Individual',
      phone: trimmedPhone || null,
      email: opts.email || null,
      source: 'Website',
    })
    .select('id')
    .single()

  if (error || !created) return { ok: false, error: error?.message || 'Failed to create customer record' }
  return { ok: true, match: { customerId: created.id, reusedExisting: false } }
}
