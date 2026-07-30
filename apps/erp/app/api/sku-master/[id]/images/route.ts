import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'

// ---------- GET (list images for a SKU) ----------
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const { data, error } = await supabaseAdmin
    .from('product_images')
    .select('*')
    .eq('sku_id', id)
    .order('sort_order', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data)
}

// ---------- POST (attach an already-uploaded image) ----------
// The client must first PUT the file to the signed URL from
// POST /api/storage/upload-url (bucket: 'product-images'), then call this with
// the returned storage key to record the metadata row.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const body = await req.json()
  const { storage_path, alt_text, width, height, is_primary } = body
  if (!storage_path) return NextResponse.json({ error: 'storage_path is required' }, { status: 400 })

  if (is_primary) {
    await supabaseAdmin.from('product_images').update({ is_primary: false }).eq('sku_id', id)
  }

  const { count } = await supabaseAdmin
    .from('product_images')
    .select('id', { count: 'exact', head: true })
    .eq('sku_id', id)

  const { data, error } = await supabaseAdmin
    .from('product_images')
    .insert({
      sku_id: id,
      storage_path,
      alt_text: alt_text || null,
      width: width || null,
      height: height || null,
      is_primary: !!is_primary || (count ?? 0) === 0, // first image defaults to primary
      sort_order: count ?? 0,
      created_by: sessionUser.id,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data, { status: 201 })
}
