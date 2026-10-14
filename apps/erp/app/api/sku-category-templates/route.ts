import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'
import { validateFieldSchema } from '@/lib/sku-category-template-validation'

export async function GET(req: NextRequest) {
  const { data, error } = await supabaseAdmin.from('sku_category_templates').select('*').order('category')
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data)
}

// ---------- POST: owner creates a brand-new SKU category ----------
// Deliberately data-only -- a new category works immediately for New SKU / Stock
// Intake / PO wizard's create-new-SKU (all schema-driven off this table), but a
// developer still needs to register it in NON_SERIALIZED_CATEGORIES (if it's
// fungible/quantity-only) and TYPE_TO_CATEGORY (to reach the legacy Purchases quick-
// entry dialog's Type dropdown) for full integration -- surfaced in the UI, not hidden.
export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json()
  const category = String(body.category || '').trim().toUpperCase()
  const displayName = String(body.display_name || '').trim()

  if (!/^[A-Z0-9_]+$/.test(category)) {
    return NextResponse.json({ error: 'Category code must be uppercase letters/numbers/underscores only.' }, { status: 400 })
  }
  if (!displayName) {
    return NextResponse.json({ error: 'Display name is required.' }, { status: 400 })
  }

  const { data: existing } = await supabaseAdmin
    .from('sku_category_templates')
    .select('category')
    .eq('category', category)
    .maybeSingle()
  if (existing) return NextResponse.json({ error: `Category "${category}" already exists.` }, { status: 400 })

  const fieldSchema = body.field_schema || { fields: [], variant_fields: [] }
  const schemaError = validateFieldSchema(fieldSchema)
  if (schemaError) return NextResponse.json({ error: schemaError }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('sku_category_templates')
    .insert({
      category,
      display_name: displayName,
      sku_code_format: body.sku_code_format || `SKU-${category}-{brand}-{model}`,
      field_schema: fieldSchema,
    })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAuditEvent({
    actor: { id: sessionUser!.id, email: sessionUser!.email, role: sessionUser!.role },
    actionType: 'create',
    module: 'settings',
    tableName: 'sku_category_templates',
    recordId: data.id,
    recordLabel: `${displayName} (${category})`,
  })

  return NextResponse.json(data, { status: 201 })
}
