import { supabaseAdmin } from './supabase/service'
import type { SessionUser } from './auth/session'

export const ACTIVITY_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const
export const ACTIVITY_STATUSES = ['pending', 'in_progress', 'done', 'cancelled'] as const
export const ACTIVITY_RELATED_TYPES = [
  'customer', 'sale', 'purchase_order', 'asset', 'repair_job', 'invoice', 'vendor',
] as const

// Fixed palette rather than free-text emoji -- keeps reactions lightweight and
// consistent, matches the "don't over-engineer" guidance for this feature.
export const ALLOWED_REACTIONS = ['👍', '❤️', '🎉', '👀', '🚀', '✅'] as const

// PostgREST `.or()` filter string expressing "created by me OR assigned to me".
// Owners pass no filter at all (see call sites) since they see every task.
export async function buildOwnVisibilityFilter(userId: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from('activity_assignees')
    .select('activity_id')
    .eq('user_id', userId)
  const assignedIds = (data || []).map((r) => r.activity_id)
  return assignedIds.length > 0
    ? `created_by.eq.${userId},id.in.(${assignedIds.join(',')})`
    : `created_by.eq.${userId}`
}

export async function canSeeActivity(
  sessionUser: SessionUser,
  activityId: string,
  createdBy: string
): Promise<boolean> {
  if (sessionUser.role === 'owner') return true
  if (createdBy === sessionUser.id) return true
  const { data } = await supabaseAdmin
    .from('activity_assignees')
    .select('id')
    .eq('activity_id', activityId)
    .eq('user_id', sessionUser.id)
    .maybeSingle()
  return !!data
}

export async function getProfileMap(ids: string[]): Promise<Map<string, { full_name: string | null; email?: string }>> {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)))
  if (uniqueIds.length === 0) return new Map()
  const { data } = await supabaseAdmin.from('profiles').select('id, full_name').in('id', uniqueIds)
  return new Map((data || []).map((p) => [p.id, { full_name: p.full_name }]))
}

// Assignees must be active users who could actually open the Activity Hub --
// otherwise a task could be "assigned" to someone who can never see it.
export async function areValidAssignees(userIds: string[]): Promise<boolean> {
  if (userIds.length === 0) return true
  const { data } = await supabaseAdmin
    .from('profiles').select('id, role, allowed_pages, is_active').in('id', userIds)
  if (!data || data.length !== userIds.length) return false
  return data.every((p) => p.is_active && (p.role === 'owner' || (p.allowed_pages || []).includes('activities')))
}

export async function getAssigneesForActivities(activityIds: string[]) {
  if (activityIds.length === 0) return new Map<string, string[]>()
  const { data } = await supabaseAdmin
    .from('activity_assignees')
    .select('activity_id, user_id')
    .in('activity_id', activityIds)
  const map = new Map<string, string[]>()
  for (const row of data || []) {
    const list = map.get(row.activity_id) || []
    list.push(row.user_id)
    map.set(row.activity_id, list)
  }
  return map
}
