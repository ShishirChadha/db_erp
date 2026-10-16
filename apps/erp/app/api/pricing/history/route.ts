import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'

export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  const skuId = req.nextUrl.searchParams.get('sku_id')
  if (!skuId) return NextResponse.json({ error: 'sku_id is required' }, { status: 400 })
  const { data, error } = await supabaseAdmin
    .from('sku_price_changes')
    .select('id, old_price, new_price, reason, note, changed_at, undone_at')
    .eq('sku_id', skuId).order('changed_at', { ascending: false }).limit(15)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data || [])
}
