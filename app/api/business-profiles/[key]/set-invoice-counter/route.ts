import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { financialYear } from '@/lib/sales-entry'

const VALID_KEYS = ['digitalbluez', 'techtenth', 'cash']

// ---------- POST: set an entity's sales-invoice counter (cutover from Zoho) ----------
// At the end of the transition, the ERP takes over generating invoices and must
// continue Zoho's legal series unbroken -- so its counter has to be set to the last
// number Zoho issued. `next_document_number` mints last_number+1, so set last_number
// to the last Zoho sequence number and the ERP's first invoice is the next one.
// Owner-only, and never lets the counter go backwards (would risk re-issuing a number).
export async function POST(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { key } = await params
  if (!VALID_KEYS.includes(key)) return NextResponse.json({ error: 'Unknown entity key' }, { status: 400 })

  const body = await req.json().catch(() => ({}))
  const lastNumber = Number(body.last_number)
  if (!Number.isInteger(lastNumber) || lastNumber < 0) {
    return NextResponse.json({ error: 'last_number must be a non-negative whole number (the last Zoho sequence number).' }, { status: 400 })
  }

  const fy = financialYear()

  const { data: existing } = await supabaseAdmin
    .from('invoice_sequences')
    .select('last_number')
    .eq('entity_key', key)
    .eq('doc_type', 'sales_invoice')
    .eq('financial_year', fy)
    .maybeSingle()

  if (existing && lastNumber < existing.last_number) {
    return NextResponse.json({
      error: `The counter is already at ${existing.last_number}. Refusing to move it backwards to ${lastNumber} -- that could re-issue an already-used number.`,
    }, { status: 409 })
  }

  const { error } = await supabaseAdmin
    .from('invoice_sequences')
    .upsert(
      { entity_key: key, doc_type: 'sales_invoice', financial_year: fy, last_number: lastNumber, prefix: null },
      { onConflict: 'entity_key,doc_type,financial_year' }
    )
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true, entity_key: key, financial_year: fy, last_number: lastNumber, next_will_be: lastNumber + 1 })
}
