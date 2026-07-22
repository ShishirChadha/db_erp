'use client'

import { useRole } from '@/lib/auth/useRole'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

// Page-level guard for owner-only screens (vendors, PO/PI, reports, settings, expenses).
// This is UX polish, not the real security boundary -- every API route these pages call
// enforces the same owner check server-side regardless of what renders here.
export default function RequireOwner({ children }: { children: React.ReactNode }) {
  const { role, loading, isOwner } = useRole()
  const router = useRouter()

  useEffect(() => {
    if (!loading && !isOwner) {
      router.replace('/dashboard')
    }
  }, [loading, isOwner, router])

  if (loading) {
    return <div className="p-4 text-sm text-gray-500">Loading...</div>
  }

  if (!isOwner) {
    return <div className="p-4 text-sm text-gray-500">Redirecting...</div>
  }

  return <>{children}</>
}
