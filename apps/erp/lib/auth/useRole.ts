'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export type Role = 'owner' | 'manager' | 'employee'

export function useRole() {
  const [role, setRole] = useState<Role | null>(null)
  const [allowedPages, setAllowedPages] = useState<string[]>([])
  const [pageEditKeys, setPageEditKeys] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const supabase = createClient()

    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        if (!cancelled) { setRole(null); setAllowedPages([]); setPageEditKeys([]); setLoading(false) }
        return
      }
      const { data: profile } = await supabase
        .from('profiles')
        .select('role, is_active, allowed_pages')
        .eq('id', user.id)
        .single()

      // Mirrors lib/auth/session.ts's getCookieSessionUser() -- RLS policy
      // "Staff read own page actions" (profile_id = auth.uid() OR is_owner()) permits this.
      const { data: editRows } = await supabase
        .from('profile_page_actions')
        .select('page_key')
        .eq('profile_id', user.id)
        .eq('can_edit', true)

      if (!cancelled) {
        setRole(profile?.is_active ? (profile.role as Role) : null)
        setAllowedPages(profile?.is_active ? (profile.allowed_pages || []) : [])
        setPageEditKeys(profile?.is_active ? (editRows || []).map(r => r.page_key) : [])
        setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [])

  const isOwner = role === 'owner'
  const isManagerOrAbove = role === 'owner' || role === 'manager'
  const hasPageAccess = (key: string | string[]) => {
    if (isOwner) return true
    const keys = Array.isArray(key) ? key : [key]
    return keys.some(k => allowedPages.includes(k))
  }
  const canEditPage = (key: string) => isOwner || pageEditKeys.includes(key)

  return { role, loading, isOwner, isManagerOrAbove, allowedPages, pageEditKeys, hasPageAccess, canEditPage }
}
