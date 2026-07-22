import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'

async function getUser(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) return null
  const token = authHeader.slice(7)
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token)
  return error ? null : user
}

// ---------- POST: qc_passed -> ready_for_sale ----------
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const user = await getUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: asset } = await supabaseAdmin
    .from('asset_ledger')
    .select('status')
    .eq('id', id)
    .single()

  if (!asset || asset.status !== 'qc_passed') {
    return NextResponse.json(
      { error: `Only assets in 'qc_passed' status can be marked ready for sale` },
      { status: 400 }
    )
  }

  const { error } = await supabaseAdmin
    .from('asset_ledger')
    .update({ status: 'ready_for_sale' })
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true, status: 'ready_for_sale' })
}
