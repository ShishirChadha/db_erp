import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser } from '@/lib/auth/session'

// Employee-safe subset of business_profiles -- just enough for New Entry -> Sell to
// derive whether the selected entity charges GST, without exposing GSTIN/bank/other
// sensitive fields (those stay behind the owner-only GET /api/business-profiles).
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabaseAdmin
    .from('business_profiles')
    .select('key, is_gst_registered')
    .order('key')

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data)
}
