import { supabaseAdmin } from './supabase/service'
import type { SessionUser } from './auth/session'
import { isManagerOrAbove } from './auth/session'

export const LEAD_SET_SOURCE_TYPES = ['upload', 'manual', 'scrape', 'customers_snapshot'] as const
export const LEAD_SET_STATUSES = ['active', 'archived'] as const
export const LEAD_STATUS_CATEGORY = 'lead_status'
export const DEFAULT_LEAD_STATUS = 'New'

// The five contact fields a working-copy lead snapshots at fork time, and the
// only fields merge-preview ever diffs. Status is tracked separately, since a
// working copy always resets it (see assign/route.ts) rather than carrying
// the master's status forward.
export const LEAD_CONTACT_FIELDS = ['name', 'phone', 'email', 'address', 'external_identifier'] as const
export type LeadContactSnapshot = Record<(typeof LEAD_CONTACT_FIELDS)[number], string | null>

export interface LeadSetRow {
  id: string
  current_assignee_id: string | null
}

// "Worked" for the Sets list's Worked/Total count and the Set-detail counts.
// Used to only count activity_id (a logged remark/follow-up) -- but changing
// a lead's status (e.g. New -> Contacted) is just as real a sign of effort
// and didn't move the counter at all, which read as "stuck at 0" even while
// an employee was visibly working through a list by status alone. Counting
// either signal is what the owner actually wants reflected here.
export function isLeadWorked(lead: { activity_id: string | null; status: string }): boolean {
  return !!lead.activity_id || lead.status !== DEFAULT_LEAD_STATUS
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

export interface LeadMatch { lead_id: string; set_id: string; set_name: string; matched_on: 'phone' | 'email' | 'name' }

// Broader than findDuplicatePhones() -- used by merge-preview to find
// candidate existing leads for a brand-new (no source_lead_id) working-copy
// lead, since a referral's phone might be blank but its name/email still
// matches something already on file. Checked in order of reliability: an
// exact phone match is trusted most, then email, then a case/whitespace-
// insensitive name match (the weakest signal, same caveat as
// checkDuplicateCustomer()'s name-only check -- names repeat, so this is
// surfaced to the owner as a candidate to confirm, never an auto-merge).
export async function findLeadMatches(lead: { phone?: string | null; email?: string | null; name?: string | null }, excludeLeadId?: string): Promise<LeadMatch[]> {
  const matches: LeadMatch[] = []
  const seen = new Set<string>()
  const push = (rows: any[] | null, matchedOn: LeadMatch['matched_on']) => {
    for (const row of rows || []) {
      if (excludeLeadId && row.id === excludeLeadId) continue
      if (seen.has(row.id)) continue
      seen.add(row.id)
      matches.push({ lead_id: row.id, set_id: row.set_id, set_name: row.lead_sets?.name || 'Unknown set', matched_on: matchedOn })
    }
  }

  const phone = lead.phone?.trim()
  if (phone) {
    const { data } = await supabaseAdmin.from('leads').select('id, set_id, lead_sets ( name )').eq('is_deleted', false).eq('phone', phone)
    push(data, 'phone')
  }
  const email = lead.email?.trim()
  if (email) {
    const { data } = await supabaseAdmin.from('leads').select('id, set_id, lead_sets ( name )').eq('is_deleted', false).ilike('email', email)
    push(data, 'email')
  }
  const name = lead.name?.trim()
  if (name) {
    const { data } = await supabaseAdmin.from('leads').select('id, set_id, lead_sets ( name )').eq('is_deleted', false).ilike('name', name)
    push(data, 'name')
  }
  return matches
}

// The snapshot captured on a working-copy lead at fork time, and the same
// shape read back off a live lead row for comparison -- kept as one helper so
// merge-preview and the fork action can never drift on which fields count.
export function snapshotLeadContact(lead: Record<string, any>): LeadContactSnapshot {
  return {
    name: lead.name ?? null,
    phone: lead.phone ?? null,
    email: lead.email ?? null,
    address: lead.address ?? null,
    external_identifier: lead.external_identifier ?? null,
  }
}
