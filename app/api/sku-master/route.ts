import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { resolveOrCreateSku } from '@/lib/sku-resolver'
import { getSessionUser } from '@/lib/auth/session'
import { redactForRole, redactManyForRole } from '@/lib/auth/redact'

export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const search = searchParams.get('search')

  let query = supabaseAdmin
    .from('sku_master')
    .select('*')
    .eq('status', 'active')
    .order('full_sku_code')

  if (search) {
    query = query.or(`full_sku_code.ilike.%${search}%,sku_description.ilike.%${search}%`)
  }

  const { data, error } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(redactManyForRole(data || [], 'sku_master', sessionUser.role))
}

export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const {
    category,
    item_type,
    brand,
    model_name,
    specifications,
    selling_price_default,
    reorder_level = 5,
  } = body
  // base_cost is owner-only data -- an employee-submitted value is silently ignored
  // rather than trusted from the request body.
  const base_cost = sessionUser.role === 'owner' ? body.base_cost : undefined

  let result
  try {
    result = await resolveOrCreateSku({
      category,
      item_type,
      brand,
      model_name,
      specifications: specifications || {},
      base_cost,
      selling_price_default,
      reorder_level,
      sku_description: body.sku_description,
      hsn_code: body.hsn_code,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }

  const sku = redactForRole(result.sku, 'sku_master', sessionUser.role)
  if (!result.created) {
    return NextResponse.json(
      { sku, message: 'Exact match found, returning existing variant' },
      { status: 200 }
    )
  }
  return NextResponse.json({ sku, message: 'New variant created' }, { status: 201 })
}