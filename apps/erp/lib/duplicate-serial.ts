import { supabaseAdmin } from '@/lib/supabase/service'

export interface DuplicateSerialMatch {
  id: string
  asset_number: string | null
  serial_number: string
  source: string
  status: string
  po_id: string | null
  sku_id: string
}

// serial_number is the natural identity key for a physical unit but carries no
// DB-level uniqueness constraint (docs/decisions.md, "Architectural Analysis:
// Duplication, Corrections, Repairs, Zoho Transition"). Every caller (stock intake,
// PO receiving, manual stock edit) now treats a match as a hard block -- no
// confirm-and-proceed override -- after a real live duplicate (serial PG02SA4Q) got
// created through the old click-past-the-warning path. Existing legacy duplicates
// from before this was hardened still need owner reconciliation directly in the DB/
// Stock page, not through these entry doors.
//
// One documented carve-out: PO receive (app/api/purchase-orders/[id]/receive) uses
// po_id/sku_id on the match to tell a real duplicate apart from the same physical
// unit catching up on paperwork (an employee-intake row, still unattached to any PO,
// for the same SKU) -- that case gets auto-promoted onto the PO instead of blocked,
// mirroring /api/purchase-orders/from-intake. Every other caller still hard-blocks.
export async function findDuplicateSerial(
  serialNumber: string | null | undefined,
  excludeId?: string
): Promise<DuplicateSerialMatch | null> {
  const normalized = (serialNumber || '').trim()
  if (!normalized) return null

  let query = supabaseAdmin
    .from('asset_ledger')
    .select('id, asset_number, serial_number, source, status, is_deleted, po_id, sku_id')
    .ilike('serial_number', normalized)
  if (excludeId) query = query.neq('id', excludeId)

  const { data } = await query
  const candidates = (data || []).filter((r) => !r.is_deleted)
  if (candidates.length === 0) return null
  // Prefer a sold match when several rows share this serial -- a sold duplicate is
  // the higher-severity signal (it drives the hard block for employees), so it must
  // win over a still-in-stock duplicate regardless of row order.
  const match = candidates.find((r) => r.status === 'sold') || candidates[0]

  return {
    id: match.id,
    asset_number: match.asset_number,
    serial_number: match.serial_number,
    source: match.source,
    status: match.status,
    po_id: match.po_id,
    sku_id: match.sku_id,
  }
}
