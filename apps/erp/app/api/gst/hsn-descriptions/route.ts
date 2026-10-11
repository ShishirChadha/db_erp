// Owner-only: the GST portal's own HSN master description for each code. GSTR-1 Table 12 (from the
// May 2025 period) carries both the user's description (`user_desc`) and the master description
// (`desc`); the GST Offline Tool takes the latter from this same master (its data/HSN.json).
import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import master from '@/lib/gst/hsn-master.json'

export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  const { codes } = await req.json().catch(() => ({ codes: [] }))
  const out: Record<string, string> = {}
  const table = master as Record<string, string>
  for (const c of Array.isArray(codes) ? codes.slice(0, 500) : []) {
    const k = String(c)
    if (table[k]) out[k] = table[k]
  }
  return NextResponse.json(out)
}
