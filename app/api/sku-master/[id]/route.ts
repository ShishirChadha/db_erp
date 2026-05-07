import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { normalizeSpecifications } from '@/lib/sku-normalizer'

// ---------- GET (detail) ----------
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const { data: sku, error } = await supabaseAdmin
    .from('sku_master')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !sku) return NextResponse.json({ error: 'SKU not found' }, { status: 404 })
  return NextResponse.json(sku)
}

// ---------- PUT (update) ----------
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await req.json()

  // Allowed fields for update
  const allowedKeys = [
    'brand',
    'model_name',
    'sku_description',
    'specifications',
    'base_cost',
    'selling_price_default',
    'reorder_level',
    'notes',
    'full_sku_code',
  ]
  const updatable: any = {}
  for (const key of allowedKeys) {
    if (body[key] !== undefined) updatable[key] = body[key]
  }

  // If specifications are being updated, normalize them first
  if (updatable.specifications !== undefined) {
    // Get the SKU's category to know which normalization rules to apply
    const { data: sku } = await supabaseAdmin
      .from('sku_master')
      .select('category')
      .eq('id', id)
      .single()

    if (sku) {
      updatable.specifications = await normalizeSpecifications(sku.category, updatable.specifications)
    }
  }

  if (Object.keys(updatable).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('sku_master')
    .update(updatable)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data)
}

// ---------- DELETE (soft delete) ----------
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const { error } = await supabaseAdmin
    .from('sku_master')
    .delete()                // ← permanent delete
    .eq('id', id)

  if (error) {
    // If the SKU is referenced elsewhere (foreign key), return a clear message
    if (error.code === '23503') {
      return NextResponse.json(
        { error: 'Cannot delete this SKU because it is used in existing purchase orders or invoices.' },
        { status: 409 }
      )
    }
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  return NextResponse.json({ success: true })
}