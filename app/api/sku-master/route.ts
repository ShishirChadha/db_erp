import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { normalizeSpecifications } from '@/lib/sku-normalizer'
import { generateBaseSkuCode } from '@/lib/sku-code-generator'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const search = searchParams.get('search')

  let query = supabaseAdmin
    .from('sku_master')
    .select('id, full_sku_code, sku_description, category')
    .eq('status', 'active')
    .order('full_sku_code')

  if (search) {
    query = query.or(`full_sku_code.ilike.%${search}%,sku_description.ilike.%${search}%`)
  }

  const { data, error } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const {
    category,
    item_type,
    brand,
    model_name,
    specifications,
    base_cost,
    selling_price_default,
    reorder_level = 5,
  } = body

  // Normalize the provided specifications before saving
  const normalizedSpecs = await normalizeSpecifications(category, specifications || {})

 
  // --- 1. Generate base SKU code using category template format ---
const baseSkuCode = await generateBaseSkuCode(category, normalizedSpecs)

  // Check for existing variants
  const { data: existing } = await supabaseAdmin
    .from('sku_master')
    .select('variant_number, specifications')
    .eq('base_sku_code', baseSkuCode)
    .order('variant_number', { ascending: true })

  let variantNumber = 1

  if (existing && existing.length > 0) {
    // Exact match check against existing normalized specs
    const newSpecsNorm = JSON.stringify(normalizedSpecs)
    for (const variant of existing) {
      if (JSON.stringify(variant.specifications) === newSpecsNorm) {
        // Return existing variant
        const { data: existingSku } = await supabaseAdmin
          .from('sku_master')
          .select('*')
          .eq('base_sku_code', baseSkuCode)
          .eq('variant_number', variant.variant_number)
          .single()
        return NextResponse.json(
          { sku: existingSku, message: 'Exact match found, returning existing variant' },
          { status: 200 }
        )
      }
    }
    // No exact match → increment variant number
    variantNumber = existing[existing.length - 1].variant_number + 1
  }

  const fullSkuCode = `${baseSkuCode}-${String(variantNumber).padStart(3, '0')}`

  // Insert
  const { data: newSku, error: insertErr } = await supabaseAdmin
    .from('sku_master')
    .insert({
      base_sku_code: baseSkuCode,
      variant_number: variantNumber,
      full_sku_code: fullSkuCode,
      category,
      item_type: item_type || category,
      brand: brand || '',
      model_name: model_name || '',
      specifications: normalizedSpecs,
      sku_description: body.sku_description || `${brand} ${model_name}`,
      base_cost: base_cost || null,
      selling_price_default: selling_price_default || null,
      reorder_level,
      quantity_in_stock: 0,
    })
    .select()
    .single()

  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 })

  return NextResponse.json({ sku: newSku, message: 'New variant created' }, { status: 201 })
}