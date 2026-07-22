'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export type Role = 'owner' | 'employee'

export function useRole() {
  const [role, setRole] = useState<Role | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const supabase = createClient()

    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        if (!cancelled) { setRole(null); setLoading(false) }
        return
      }
      const { data: profile } = await supabase
        .from('profiles')
        .select('role, is_active')
        .eq('id', user.id)
        .single()

      if (!cancelled) {
        setRole(profile?.is_active ? (profile.role as Role) : null)
        setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [])

  return { role, loading, isOwner: role === 'owner' }
}
