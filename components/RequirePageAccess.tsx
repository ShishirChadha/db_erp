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

  useEffect(() => {
    if (!loading && !allowed) {
      router.replace('/dashboard')
    }
  }, [loading, allowed, router])

  if (loading) {
    return <div className="p-4 text-sm text-gray-500">Loading...</div>
  }

  if (!allowed) {
    return <div className="p-4 text-sm text-gray-500">Redirecting...</div>
  }

  return <>{children}</>
}
