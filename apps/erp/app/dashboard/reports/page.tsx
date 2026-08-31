import { redirect } from 'next/navigation'
import { getCookieSessionUser, hasPageAccess } from '@/lib/auth/session'
import ReportsClient from './reports-client'

// Reporting rebuild (2026-08-29): this page used to fetch five whole tables
// (select('*'), no is_deleted filters, no pagination -- silently truncated at
// PostgREST's row cap) into the browser and reduce() them client-side. It now
// renders a thin client shell that calls /api/reports, which is backed by the
// report_* SQL RPCs (single source of truth -- see the reporting-metrics
// migrations and docs/current-progress.md). No data is fetched here.
export default async function ReportsPage() {
  const sessionUser = await getCookieSessionUser()
  if (!hasPageAccess(sessionUser, 'reports')) redirect('/dashboard')

  return <ReportsClient />
}
