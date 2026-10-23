import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, SessionCheckUnavailable } from '@/lib/auth/session'

// Second opinion before the browser signs a user out (lib/api-client.ts).
// 200 = session fine, 401 = genuinely not signed in (expired/revoked/
// deactivated), 503 = could not check right now -- only a 401 may log anyone out.
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const user = await getSessionUser(req)
    return NextResponse.json({ valid: !!user }, { status: user ? 200 : 401 })
  } catch (err) {
    if (err instanceof SessionCheckUnavailable) return NextResponse.json({ valid: null }, { status: 503 })
    throw err
  }
}
