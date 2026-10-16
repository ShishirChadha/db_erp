import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { loadBoard } from '@/lib/pricing-board'

// Owner-only: this response carries purchase cost and margin inputs.
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  try {
    return NextResponse.json(await loadBoard())
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
