'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export type Role = 'owner' | 'employee'

export function useRole() {
  const [role, setRole] = useState<Role | null>(null)
  const [allowedPages, setAllowedPages] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const supabase = createClient()

    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        if (!cancelled) { setRole(null); setAllowedPages([]); setLoading(false) }
        return
      }
      const { data: profile } = await supabase
        .from('profiles')
        .select('role, is_active, allowed_pages')
        .eq('id', user.id)
        .single()

      if (!cancelled) {
        setRole(profile?.is_active ? (profile.role as Role) : null)
        setAllowedPages(profile?.is_active ? (profile.allowed_pages || []) : [])
        setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [])

  const isOwner = role === 'owner'
  const hasPageAccess = (key: string | string[]) => {
    if (isOwner) return true
    const keys = Array.isArray(key) ? key : [key]
    return keys.some(k => allowedPages.includes(k))
  }

  return { role, loading, isOwner, allowedPages, hasPageAccess }
}
