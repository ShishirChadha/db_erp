import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth/session'
import { STATE_CODE_TO_NAME } from '@/lib/gstStateCodes'

// PIN code -> city/state via India Post's public directory (api.postalpincode.in),
// proxied so the browser doesn't depend on that host's CORS and so repeat lookups
// hit Next's fetch cache (PIN data barely changes -- cached 30 days).
//
// City = the Head Post Office's name when the PIN has one ("Noida", "Gurgaon"),
// because India Post's District is the administrative name people don't write
// ("Gautam Buddha Nagar"); falls back to District otherwise.

const normalize = (s: string) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z]/g, '')

function stateCodeFromName(name: string): string | null {
  const n = normalize(name)
  const hit = Object.entries(STATE_CODE_TO_NAME).find(([code, label]) => !['25', '28'].includes(code) && normalize(label) === n)
  return hit ? hit[0] : null
}

export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const pin = req.nextUrl.searchParams.get('pin')?.trim() || ''
  if (!/^\d{6}$/.test(pin)) return NextResponse.json({ error: 'PIN must be 6 digits.' }, { status: 400 })

  try {
    const res = await fetch(`https://api.postalpincode.in/pincode/${pin}`, {
      signal: AbortSignal.timeout(6000),
      next: { revalidate: 60 * 60 * 24 * 30 },
    })
    if (!res.ok) return NextResponse.json({ error: 'PIN lookup service unavailable.' }, { status: 502 })
    const body = await res.json()
    const offices: any[] = body?.[0]?.PostOffice || []
    if (body?.[0]?.Status !== 'Success' || offices.length === 0) {
      return NextResponse.json({ error: 'No post office found for this PIN.' }, { status: 404 })
    }

    const head = offices.find((o) => o.BranchType === 'Head Post Office')
    const district = String(offices[0].District || '').trim()
    const city = String(head?.Name || '').trim() || district
    const state = String(offices[0].State || '').trim()
    return NextResponse.json({
      city,
      district,
      state,
      state_code: stateCodeFromName(state),
      areas: Array.from(new Set(offices.map((o) => String(o.Name || '').trim()).filter(Boolean))),
    })
  } catch {
    return NextResponse.json({ error: 'PIN lookup timed out.' }, { status: 504 })
  }
}
