import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'

// Photos of published products with no alt text yet (edit one via
// PATCH /api/sku-master/[id]/images/[imageId], which already accepts alt_text).
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { data, error } = await supabaseAdmin
    .from('product_images')
    .select('id, sku_id, storage_path, alt_text, is_primary, sku_master!inner(full_sku_code, brand, model_name, web_title, is_published)')
    .eq('sku_master.is_published', true)
    .or('alt_text.is.null,alt_text.eq.')
    .order('is_primary', { ascending: false })
    .limit(100)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}
