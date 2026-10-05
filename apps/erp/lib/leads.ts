import { supabaseAdmin } from './supabase/service'
import type { SessionUser } from './auth/session'
import { isManagerOrAbove } from './auth/session'

export const LEAD_SET_SOURCE_TYPES = ['upload', 'manual', 'scrape', 'customers_snapshot'] as const
export const LEAD_SET_STATUSES = ['active', 'archived'] as const
export const LEAD_STATUS_CATEGORY = 'lead_status'
export const DEFAULT_LEAD_STATUS = 'New'

export interface LeadSetRow {
  id: string
  current_assignee_id: string | null
}

// Whether sessionUser may read/write within a given Set: manager-or-above sees/
// edits everything; a plain employee only the Set they currently hold. Mirrors
// the RLS policy in backups/20261006_lead_sets.sql -- this is the API-layer
// half of that same boundary, checked explicitly rather than relied on via RLS
// alone, since every route here runs on supabaseAdmin (which bypasses RLS).
export function isCurrentHolderOrManager(sessionUser: SessionUser, set: LeadSetRow): boolean {
  if (isManagerOrAbove(sessionUser)) return true
  return set.current_assignee_id === sessionUser.id
}

export async function getLeadSetOrNull(setId: string): Promise<LeadSetRow & { name: string; status: string } | null> {
  const { data } = await supabaseAdmin
    .from('lead_sets')
    .select('id, current_assignee_id, name, status')
    .eq('id', setId)
    .eq('is_deleted', false)
    .maybeSingle()
  return data || null
}

// Non-blocking cross-Set duplicate-phone lookup -- the same real person can
// legitimately appear in more than one Lead Set, so this only ever warns.
export async function findDuplicatePhones(phones: string[]): Promise<Map<string, { lead_id: string; set_id: string; set_name: string }[]>> {
  const trimmed = [...new Set(phones.map((p) => p?.trim()).filter(Boolean))]
  const result = new Map<string, { lead_id: string; set_id: string; set_name: string }[]>()
  if (trimmed.length === 0) return result

  const { data } = await supabaseAdmin
    .from('leads')
    .select('id, phone, set_id, lead_sets ( name )')
    .eq('is_deleted', false)
    .in('phone', trimmed)

  for (const row of data || []) {
    const key = (row as any).phone
    const list = result.get(key) || []
    list.push({ lead_id: (row as any).id, set_id: (row as any).set_id, set_name: (row as any).lead_sets?.name || 'Unknown set' })
    result.set(key, list)
  }
  return result
}
