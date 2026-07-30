'use client'

import { useRouter } from 'next/navigation'
import { createBrowserSupabaseClient } from '@db/db/browser'

export function LogoutButton() {
  const router = useRouter()
  const handleLogout = async () => {
    const supabase = createBrowserSupabaseClient()
    await supabase.auth.signOut()
    router.push('/')
    router.refresh()
  }
  return (
    <button type="button" onClick={handleLogout} className="text-sm text-muted-foreground hover:text-foreground">
      Log out
    </button>
  )
}
