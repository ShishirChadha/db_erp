import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, hasPageAccess } from '@/lib/auth/session'
import { getTodaysPicks } from '@/lib/marketing/suggest'

// "What should today's WhatsApp send be?" -- returns the 4 priority buckets
// (new arrivals / high-end-Macbooks / aging stock / unique configs) computed live
// from the published catalogue. Read-only, no AI cost, so no daily-cap check needed.
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPageAccess(sessionUser, 'marketing')) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  try {
    const buckets = await getTodaysPicks()
    return NextResponse.json(buckets)
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to compute suggestions' }, { status: 500 })
  }
}
