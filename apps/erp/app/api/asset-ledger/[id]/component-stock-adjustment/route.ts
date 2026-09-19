import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { insertAccessoryMovement } from '@/lib/accessory-movements'
import { logAuditEvent } from '@/lib/audit-log'

// Most recent 'receipt' unit_price for a SKU, regardless of whether a vendor was also
// recorded on that receipt -- getLastEntryVendorsBySku (lib/accessory-movements.ts)
// requires vendor_id to be set, which a price-only receipt wouldn't have, so this is
// a separate, narrower lookup. Same "effective date" client-side pick as everywhere
// else (purchase_date falling back to created_at's day) -- PostgREST can't COALESCE
// that in a plain .order().
async function getLastReceiptPrice(skuId: string): Promise<number | null> {
  const { data } = await supabaseAdmin
    .from('stock_movements')
    .select('unit_price, purchase_date, created_at')
    .eq('sku_id', skuId)
    .eq('movement_type', 'receipt')
    .not('unit_price', 'is', null)
  let best: { unitPrice: number; effectiveDate: string; createdAt: string } | null = null
  for (const row of data || []) {
    const effectiveDate: string = row.purchase_date || row.created_at?.slice(0, 10) || ''
    if (!best || effectiveDate > best.effectiveDate || (effectiveDate === best.effectiveDate && row.created_at > best.createdAt)) {
      best = { unitPrice: row.unit_price, effectiveDate, createdAt: row.created_at }
    }
  }
  return best?.unitPrice ?? null
}

// ---------- POST: move accessory stock for a RAM/SSD component swap on a unit, and
// automatically cost the swap against that unit (asset_cost_adjustments) using the
// accessory SKU's own last-recorded purchase price -- so a unit's true cost basis
// (and therefore COGS/margin reporting, v_report_sale_lines) reflects every component
// actually pulled from our own stock, not just whatever an upfront manual "Additional
// cost" guess happened to capture. Several components on the same reassignment (e.g.
// both RAM and SSD) each insert their own adjustment row and simply add up via the
// existing SUM() in v_report_sale_lines -- no combining step needed here.
//
// Open to any signed-in role, same as reassign-sku/FixSkuDialog itself -- cost
// tracking must not depend on who physically did the swap. The computed amount is
// never returned to a non-owner caller, matching every other cost surface in this app.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json()
  const { sku_id, quantity, direction, field, from, to } = body as {
    sku_id?: string; quantity?: number; direction?: 'up' | 'down'; field?: string; from?: string; to?: string
  }

  if (!sku_id || !quantity || quantity <= 0 || (direction !== 'up' && direction !== 'down')) {
    return NextResponse.json({ error: 'sku_id, a positive quantity, and direction (up/down) are required.' }, { status: 400 })
  }

  const label = (field || 'component').toUpperCase()
  const note = `${direction === 'down' ? 'Removed' : 'Used'} during SKU reassignment (${label} ${from ?? '?'} → ${to ?? '?'})`

  const { error: moveErr } = await insertAccessoryMovement({
    skuId: sku_id,
    movementType: 'adjustment',
    // 'up' = RAM/SSD increased, sourced from our stock -> deduct. 'down' = decreased,
    // the removed part goes back into stock -> receive.
    quantityChange: direction === 'down' ? quantity : -quantity,
    notes: note,
    createdBy: sessionUser.id,
  })
  if (moveErr) return NextResponse.json({ error: moveErr.message }, { status: 400 })

  let costRecorded = false
  let signedAmount: number | null = null
  const unitPrice = await getLastReceiptPrice(sku_id)
  if (unitPrice != null) {
    const amount = Math.round(unitPrice * quantity * 100) / 100
    signedAmount = direction === 'down' ? -amount : amount
    const { error: costErr } = await supabaseAdmin.from('asset_cost_adjustments').insert({
      asset_id: id,
      amount: signedAmount,
      reason: `${label} ${direction === 'down' ? 'removed' : 'added'} (${quantity} unit${quantity === 1 ? '' : 's'} @ ₹${unitPrice.toFixed(2)}, from last purchase price)`,
      added_by: sessionUser.id,
    })
    if (!costErr) {
      costRecorded = true
      await logAuditEvent({
        actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
        actionType: 'create',
        module: 'stock',
        tableName: 'asset_cost_adjustments',
        recordId: id,
        metadata: { sku_id, quantity, direction, field },
        reason: 'Auto-recorded from accessory component swap during SKU reassignment',
      })
    }
  }

  return NextResponse.json({
    success: true,
    cost_recorded: costRecorded,
    // Cost figures stay owner-only, matching every other cost surface in this app --
    // omitted from the response entirely for a non-owner caller, not just unrendered.
    ...(isOwner(sessionUser) ? { amount: signedAmount } : {}),
  })
}
