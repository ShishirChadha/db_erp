'use client'

import { useRole } from '@/lib/auth/useRole'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

// Priority order of pages to fall back to when the current page is denied and
// the default fallback ('/dashboard') isn't safe -- specifically, when 'dashboard'
// is itself the page being gated, redirecting there would loop forever.
const FALLBACK_ORDER: { key: string; path: string }[] = [
  { key: 'new_entry', path: '/dashboard/entry' },
  { key: 'accessories', path: '/dashboard/accessories' },
  { key: 'repair_jobs', path: '/dashboard/repair-jobs' },
  { key: 'live_stock', path: '/dashboard/live-stock' },
  { key: 'sku_master', path: '/dashboard/sku-master' },
  { key: 'invoices', path: '/dashboard/invoices' },
  { key: 'customers', path: '/dashboard/customers' },
  { key: 'activities', path: '/dashboard/activities' },
  { key: 'sales', path: '/dashboard/sales' },
]

// Page-level guard for pages gated by a specific page-key in profiles.allowed_pages
// (owners always pass). This is UX polish, not the real security boundary -- the API
// routes these pages call enforce the same page-access check server-side, same
// pattern as components/RequireOwner.tsx.
export default function RequirePageAccess({ pageKey, children }: { pageKey: string | string[]; children: React.ReactNode }) {
  const { loading, hasPageAccess, allowedPages } = useRole()
  const allowed = hasPageAccess(pageKey)
  const router = useRouter()

  const keys = Array.isArray(pageKey) ? pageKey : [pageKey]
  const isDashboardCheck = keys.includes('dashboard')
  const fallbackPath = isDashboardCheck
    ? FALLBACK_ORDER.find(p => allowedPages.includes(p.key))?.path ?? null
    : '/dashboard'

  useEffect(() => {
    if (!loading && !allowed && fallbackPath) {
      router.replace(fallbackPath)
    }
  }, [loading, allowed, fallbackPath, router])

  if (loading) {
    return <div className="p-4 text-sm text-gray-500">Loading...</div>
  }

  if (!allowed) {
    if (!fallbackPath) {
      return (
        <div className="p-4 text-sm text-gray-500">
          Your account doesn't have access to any pages yet. Contact the owner to get set up.
        </div>
      )
    }
    return <div className="p-4 text-sm text-gray-500">Redirecting...</div>
  }

  return <>{children}</>
}
