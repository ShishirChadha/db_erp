import { NextRequest } from 'next/server'
import { jwtVerify, createRemoteJWKSet } from 'jose'
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

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!

// jose caches the JWKS response internally (keyed by this URL instance) and
// only refetches on a cache miss or after its cooldown, so this does not
// mean a network call on every request -- it replaces supabaseAdmin.auth
// .getUser(token), which was both a network round trip to the Auth server
// *and* 5 downstream auth-table queries (sessions/identities/mfa_factors/
// users/mfa_amr_claims), on every single authenticated API call. Signature
// + expiry + issuer is exactly what getUser() itself checks for a bearer
// token; the thing it adds beyond that -- live revocation of an
// already-issued token before its (~1hr) expiry -- is not something this
// app relies on, since immediate access revocation here is done via
// profiles.is_active, which every request below still re-checks live.
const jwks = createRemoteJWKSet(new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`))

async function verifyAccessToken(token: string): Promise<{ id: string; email: string | undefined } | null> {
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer: `${SUPABASE_URL}/auth/v1` })
    if (!payload.sub) return null
    return { id: payload.sub, email: typeof payload.email === 'string' ? payload.email : undefined }
  } catch {
    return null
  }
}

// Bearer-token pattern -- for API routes called via lib/api-client.ts's apiFetch(),
// which attaches the browser session's access_token as Authorization: Bearer <token>.
export async function getSessionUser(req: NextRequest): Promise<SessionUser | null> {
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) return null
  const token = authHeader.slice(7)

  const user = await verifyAccessToken(token)
  if (!user) return null

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role, is_active, allowed_pages, profile_page_actions(page_key, can_edit)')
    .eq('id', user.id)
    .single()

  if (!profile || !profile.is_active) return null

  const pageEditKeys = (profile.profile_page_actions || [])
    .filter((a: { page_key: string; can_edit: boolean }) => a.can_edit)
    .map((a: { page_key: string; can_edit: boolean }) => a.page_key)

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
