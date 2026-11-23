import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, hasPageAccess, isOwner } from '@/lib/auth/session'
import { resolveEntityKey } from '@/lib/invoice-finalize'
import { voidTradeIn } from '@/lib/trade-ins'

// ---------- GET: one trade-in, with what the buyback slip prints ----------
// The owner, anyone with the Trade-ins page, or whoever took this trade-in (so
// the person at the counter can print the slip straight away).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  const { data: t } = await supabaseAdmin.from('trade_ins')
    .select(`*,
      customers(customer_name, phone, email, address_line1, address_line2, city, state, pincode),
      asset:asset_ledger!trade_ins_asset_id_fkey(serial_number, asset_number, sku_master!purchase_order_asset_mapping_sku_id_fkey(sku_description, full_sku_code)),
      sale:sales!trade_ins_sale_id_fkey(id, sale_date, sale_total, amount_paid, asset_ledger_id, accessory_id),
      previous_sale:sales!trade_ins_previous_sale_id_fkey(sale_date, sale_total),
      entered:profiles!trade_ins_entered_by_fkey(full_name)`)
    .eq('id', id).maybeSingle()
  if (!t) return NextResponse.json({ error: 'Trade-in not found.' }, { status: 404 })
  if (!hasPageAccess(sessionUser, 'trade_ins') && t.entered_by !== sessionUser.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const [{ data: entity }, saleUnit] = await Promise.all([
    supabaseAdmin.from('business_profiles').select('legal_name, address, state, gstin, contact, logo_url')
      .eq('key', resolveEntityKey(t.payment_account)).maybeSingle(),
    t.sale?.asset_ledger_id
      ? supabaseAdmin.from('asset_ledger').select('serial_number, sku_master!purchase_order_asset_mapping_sku_id_fkey(sku_description)')
          .eq('id', t.sale.asset_ledger_id).maybeSingle().then((r) => r.data as any)
      : Promise.resolve(null),
  ])
  return NextResponse.json({
    ...t,
    entity,
    sale: t.sale ? { ...t.sale, unit: saleUnit ? { serial_number: saleUnit.serial_number, description: saleUnit.sku_master?.sku_description ?? null } : null } : null,
  })
}

// ---------- DELETE: owner undoes a trade-in (wrong value, wrong unit, test) ----------
// Only while the unit is still with us and hasn't been sold again. The 'Trade-in'
// payment comes off the sale, and the unit goes back to how it was (sold to the
// customer, or out of stock if it was never ours).
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Only the owner can undo a trade-in.' }, { status: 403 })
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const reason = String(body?.reason || '').trim()
  if (!reason) return NextResponse.json({ error: 'Say why the trade-in is being undone.' }, { status: 400 })
  const result = await voidTradeIn(id, { id: sessionUser!.id, email: sessionUser!.email, role: sessionUser!.role }, reason)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ success: true })
}
