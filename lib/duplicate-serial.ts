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
// Duplication, Corrections, Repairs, Zoho Transition") -- a handful of real legacy
// duplicates already exist awaiting owner reconciliation, so this stays a soft,
// overridable warning rather than a hard block or a live unique index.
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

export function duplicateSerialMessage(serialNumber: string, dup: DuplicateSerialMatch): string {
  const tag = dup.asset_number || 'no tag yet'
  return `Serial "${serialNumber}" already exists as ${tag} (status: ${dup.status}, source: ${dup.source}). Submit again to confirm this is a legitimate separate entry.`
}
