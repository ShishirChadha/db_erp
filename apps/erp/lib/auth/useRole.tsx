'use client'

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { createClient } from '@/lib/supabase/client'

export type Role = 'owner' | 'manager' | 'employee'

export interface UiPreferences {
  theme?: string
  hiddenItems?: string[]
  pinnedItems?: string[]
  groupOrder?: string[]
}

interface RoleContextValue {
  role: Role | null
  loading: boolean
  isOwner: boolean
  isManagerOrAbove: boolean
  allowedPages: string[]
  pageEditKeys: string[]
  uiPreferences: UiPreferences
  hasPageAccess: (key: string | string[]) => boolean
  canEditPage: (key: string) => boolean
}

const RoleContext = createContext<RoleContextValue | null>(null)

// Fetches auth.getUser() + profiles + profile_page_actions exactly once per
// session (mounted at the app root, see app/layout.tsx) instead of once per
// component that needs role/permission data -- this hook used to run its own
// independent fetch on every call, and it's called from 25+ files (sidebar,
// every page's RequirePageAccess wrapper, ThemeProvider, RequireOwner, etc.),
// so a single page nav could previously fire this fetch 3-4x concurrently.
export function RoleProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<Role | null>(null)
  const [allowedPages, setAllowedPages] = useState<string[]>([])
  const [pageEditKeys, setPageEditKeys] = useState<string[]>([])
  const [uiPreferences, setUiPreferences] = useState<UiPreferences>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const supabase = createClient()

    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        if (!cancelled) { setRole(null); setAllowedPages([]); setPageEditKeys([]); setUiPreferences({}); setLoading(false) }
        return
      }

      // Independent of each other -- fetched in parallel rather than sequentially.
      const [{ data: profile }, { data: editRows }] = await Promise.all([
        supabase
          .from('profiles')
          .select('role, is_active, allowed_pages, ui_preferences')
          .eq('id', user.id)
          .single(),
        // Mirrors lib/auth/session.ts's getCookieSessionUser() -- RLS policy
        // "Staff read own page actions" (profile_id = auth.uid() OR is_owner()) permits this.
        supabase
          .from('profile_page_actions')
          .select('page_key')
          .eq('profile_id', user.id)
          .eq('can_edit', true),
      ])

      if (!cancelled) {
        setRole(profile?.is_active ? (profile.role as Role) : null)
        setAllowedPages(profile?.is_active ? (profile.allowed_pages || []) : [])
        setPageEditKeys(profile?.is_active ? (editRows || []).map(r => r.page_key) : [])
        setUiPreferences(profile?.is_active ? (profile.ui_preferences || {}) : {})
        setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [])

  const value = useMemo<RoleContextValue>(() => {
    const isOwner = role === 'owner'
    const isManagerOrAbove = role === 'owner' || role === 'manager'
    const hasPageAccess = (key: string | string[]) => {
      if (isOwner) return true
      const keys = Array.isArray(key) ? key : [key]
      return keys.some(k => allowedPages.includes(k))
    }
    const canEditPage = (key: string) => isOwner || pageEditKeys.includes(key)
    return { role, loading, isOwner, isManagerOrAbove, allowedPages, pageEditKeys, uiPreferences, hasPageAccess, canEditPage }
  }, [role, loading, allowedPages, pageEditKeys, uiPreferences])

  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>
}

export function useRole(): RoleContextValue {
  const ctx = useContext(RoleContext)
  if (!ctx) {
    throw new Error('useRole() must be called within <RoleProvider> (mounted in app/layout.tsx)')
  }
  return ctx
}
