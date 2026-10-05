'use client'

import { useRole } from '@/lib/auth/useRole'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

// Page-level guard for pages gated by a specific page-key in profiles.allowed_pages
// (owners always pass). This is UX polish, not the real security boundary -- the API
// routes these pages call enforce the same page-access check server-side, same
// pattern as components/RequireOwner.tsx.
export default function RequirePageAccess({ pageKey, children }: { pageKey: string | string[]; children: React.ReactNode }) {
  const { loading, hasPageAccess } = useRole()
  const allowed = hasPageAccess(pageKey)
  const router = useRouter()

  const keys = Array.isArray(pageKey) ? pageKey : [pageKey]
  const isDashboardCheck = keys.includes('dashboard')
  // 'dashboard' (the KPI overview) is gated because the owner does not want
  // every employee seeing business numbers -- so its own fallback can't be
  // '/dashboard' (infinite loop) or one of the other business pages (an
  // employee with a narrow grant set used to land on an arbitrary one of
  // those, which read as "there's no home for me here"). /dashboard/home has
  // no pageKey at all -- every signed-in profile passes it -- so it is always
  // a safe, universal landing spot regardless of allowed_pages.
  const fallbackPath = isDashboardCheck ? '/dashboard/home' : '/dashboard'

  useEffect(() => {
    if (!loading && !allowed && fallbackPath) {
      router.replace(fallbackPath)
    }
  }, [loading, allowed, fallbackPath, router])

  if (loading) {
    return <div className="p-4 text-sm text-muted-foreground">Loading...</div>
  }

  if (!allowed) {
    if (!fallbackPath) {
      return (
        <div className="p-4 text-sm text-muted-foreground">
          Your account doesn't have access to any pages yet. Contact the owner to get set up.
        </div>
      )
    }
    return <div className="p-4 text-sm text-muted-foreground">Redirecting...</div>
  }

  return <>{children}</>
}
