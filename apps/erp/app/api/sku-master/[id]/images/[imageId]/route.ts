import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'

// ---------- PATCH (set as primary) ----------
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; imageId: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id, imageId } = await params
  const body = await req.json()

  if (body.is_primary) {
    await supabaseAdmin.from('product_images').update({ is_primary: false }).eq('sku_id', id)
  }

  const { data, error } = await supabaseAdmin
    .from('product_images')
    .update({
      ...(body.is_primary !== undefined ? { is_primary: !!body.is_primary } : {}),
      ...(body.alt_text !== undefined ? { alt_text: body.alt_text } : {}),
    })
    .eq('id', imageId)
    .eq('sku_id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data)
}

// ---------- DELETE ----------
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; imageId: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id, imageId } = await params

  const { data: image } = await supabaseAdmin
    .from('product_images')
    .select('storage_path')
    .eq('id', imageId)
    .eq('sku_id', id)
    .single()

  if (!image) return NextResponse.json({ error: 'Image not found' }, { status: 404 })

  await supabaseAdmin.storage.from('product-images').remove([image.storage_path])
  const { error } = await supabaseAdmin.from('product_images').delete().eq('id', imageId)

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}
