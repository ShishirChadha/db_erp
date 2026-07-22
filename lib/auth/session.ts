import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { createClient as createServerClient } from '@/lib/supabase/server'

export type Role = 'owner' | 'employee'

export interface SessionUser {
  id: string
  email: string | undefined
  role: Role
  isActive: boolean
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
    .select('role, is_active')
    .eq('id', user.id)
    .single()

  if (!profile || !profile.is_active) return null

  return { id: user.id, email: user.email, role: profile.role as Role, isActive: profile.is_active }
}

// Cookie-session pattern -- for routes/pages using lib/supabase/server.ts's createClient()
// (relies on the "profiles_select_own" RLS policy rather than the service-role client).
export async function getCookieSessionUser(): Promise<SessionUser | null> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, is_active')
    .eq('id', user.id)
    .single()

  if (!profile || !profile.is_active) return null

  return { id: user.id, email: user.email, role: profile.role as Role, isActive: profile.is_active }
}

export function isOwner(sessionUser: SessionUser | null): sessionUser is SessionUser & { role: 'owner' } {
  return !!sessionUser && sessionUser.role === 'owner'
}
