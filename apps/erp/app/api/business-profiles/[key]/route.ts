import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'

const VALID_KEYS = ['digitalbluez', 'techtenth', 'cash']

// Owner-only edit of one business entity's branding/GST/bank details. No
// create/delete -- the three entities are fixed by the table's CHECK
// constraint; this is purely an update on the seeded rows.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { key } = await params
  if (!VALID_KEYS.includes(key)) return NextResponse.json({ error: 'Unknown entity key' }, { status: 400 })

  const body = await req.json()
  const {
    legal_name, address, state, state_code, gstin, is_gst_registered,
    logo_url, signature_url, stamp_url, bank_details, contact,
    invoice_prefix, invoice_number_format, default_terms, default_notes, active,
    invoicing_mode,
  } = body

  const updates: Record<string, any> = { updated_at: new Date().toISOString() }
  if (legal_name !== undefined) updates.legal_name = legal_name
  if (address !== undefined) updates.address = address
  if (state !== undefined) updates.state = state
  if (state_code !== undefined) updates.state_code = state_code
  if (gstin !== undefined) updates.gstin = gstin
  if (is_gst_registered !== undefined) updates.is_gst_registered = is_gst_registered
  if (logo_url !== undefined) updates.logo_url = logo_url
  if (signature_url !== undefined) updates.signature_url = signature_url
  if (stamp_url !== undefined) updates.stamp_url = stamp_url
  if (bank_details !== undefined) updates.bank_details = bank_details
  if (contact !== undefined) updates.contact = contact
  if (invoice_prefix !== undefined) updates.invoice_prefix = invoice_prefix
  if (invoice_number_format !== undefined) updates.invoice_number_format = invoice_number_format
  if (default_terms !== undefined) updates.default_terms = default_terms
  if (default_notes !== undefined) updates.default_notes = default_notes
  if (active !== undefined) updates.active = active
  if (invoicing_mode !== undefined) {
    if (!['erp', 'external'].includes(invoicing_mode)) {
      return NextResponse.json({ error: "invoicing_mode must be 'erp' or 'external'" }, { status: 400 })
    }
    updates.invoicing_mode = invoicing_mode
  }

  const { data, error } = await supabaseAdmin
    .from('business_profiles')
    .update(updates)
    .eq('key', key)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'update',
    module: 'settings',
    tableName: 'business_profiles',
    recordId: data?.id ?? key,
    recordLabel: data?.legal_name ?? key,
    metadata: { key, updated_fields: Object.keys(updates).filter((f) => f !== 'updated_at') },
  })

  return NextResponse.json(data)
}
