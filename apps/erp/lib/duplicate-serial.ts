import { supabaseAdmin } from '@/lib/supabase/service'

export interface DuplicateSerialMatch {
  id: string
  asset_number: string | null
  serial_number: string
  source: string
  status: string
}

// serial_number is the natural identity key for a physical unit but carries no
// DB-level uniqueness constraint (docs/decisions.md, "Architectural Analysis:
// Duplication, Corrections, Repairs, Zoho Transition"). Every caller (stock intake,
// PO receiving, manual stock edit) now treats a match as a hard block -- no
// confirm-and-proceed override -- after a real live duplicate (serial PG02SA4Q) got
// created through the old click-past-the-warning path. Existing legacy duplicates
// from before this was hardened still need owner reconciliation directly in the DB/
// Stock page, not through these entry doors.
export async function findDuplicateSerial(
  serialNumber: string | null | undefined,
  excludeId?: string
): Promise<DuplicateSerialMatch | null> {
  const normalized = (serialNumber || '').trim()
  if (!normalized) return null

  let query = supabaseAdmin
    .from('asset_ledger')
    .select('id, asset_number, serial_number, source, status, is_deleted')
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
  }
}
