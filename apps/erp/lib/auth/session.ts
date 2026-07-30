import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { createClient as createServerClient } from '@/lib/supabase/server'

export type Role = 'owner' | 'manager' | 'employee'

export interface SessionUser {
  id: string
  email: string | undefined
  role: Role
  isActive: boolean
  allowedPages: string[]
  pageEditKeys: string[]
}

async function fetchPageEditKeys(client: typeof supabaseAdmin, profileId: string): Promise<string[]> {
  const { data } = await client
    .from('profile_page_actions')
    .select('page_key')
    .eq('profile_id', profileId)
    .eq('can_edit', true)
  return (data || []).map(r => r.page_key)
}

// Bearer-token pattern -- for API routes called via lib/api-client.ts's apiFetch(),
// which attaches the browser session's access_token as Authorization: Bearer <token>.
export async function getSessionUser(req: NextRequest): Promise<SessionUser | null> {
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) return null
  const token = authHeader.slice(7)

  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !user) return null

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role, is_active, allowed_pages')
    .eq('id', user.id)
    .single()

  if (!profile || !profile.is_active) return null

  const pageEditKeys = await fetchPageEditKeys(supabaseAdmin, user.id)

  return { id: user.id, email: user.email, role: profile.role as Role, isActive: profile.is_active, allowedPages: profile.allowed_pages || [], pageEditKeys }
}

// Cookie-session pattern -- for routes/pages using lib/supabase/server.ts's createClient()
// (relies on the "profiles_select_own" RLS policy rather than the service-role client).
export async function getCookieSessionUser(): Promise<SessionUser | null> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, is_active, allowed_pages')
    .eq('id', user.id)
    .single()

  if (!profile || !profile.is_active) return null

  const { data: editRows } = await supabase
    .from('profile_page_actions')
    .select('page_key')
    .eq('profile_id', user.id)
    .eq('can_edit', true)
  const pageEditKeys = (editRows || []).map(r => r.page_key)

  return { id: user.id, email: user.email, role: profile.role as Role, isActive: profile.is_active, allowedPages: profile.allowed_pages || [], pageEditKeys }
}

export function isOwner(sessionUser: SessionUser | null): sessionUser is SessionUser & { role: 'owner' } {
  return !!sessionUser && sessionUser.role === 'owner'
}

// Owner or manager -- for cost/vendor visibility and PO approval, which managers get
// beyond a plain employee, but not owner-exclusive actions (user/business-profile management).
export function isManagerOrAbove(sessionUser: SessionUser | null): sessionUser is SessionUser & { role: 'owner' | 'manager' } {
  return !!sessionUser && (sessionUser.role === 'owner' || sessionUser.role === 'manager')
}

// Owners always have full access; employees/managers need the given page-key(s) in
// their profiles.allowed_pages allowlist. Accepts an array so shared utility
// routes (reachable from more than one nav area) can OR across several keys.
export function hasPageAccess(sessionUser: SessionUser | null, key: string | string[]): boolean {
  if (!sessionUser) return false
  if (isOwner(sessionUser)) return true
  const keys = Array.isArray(key) ? key : [key]
  return keys.some(k => sessionUser.allowedPages.includes(k))
}

// Whether this user may perform a mutating (edit/close) action within a given page,
// as opposed to merely viewing it. Owner always can; manager/employee need an explicit
// per-page grant in profile_page_actions -- manager gets no automatic bypass here,
// since "sees costs, approves POs" is not the same as "can edit every page it can view".
export function canEditPage(sessionUser: SessionUser | null, key: string): boolean {
  if (isOwner(sessionUser)) return true
  if (!sessionUser) return false
  return sessionUser.pageEditKeys.includes(key)
}
