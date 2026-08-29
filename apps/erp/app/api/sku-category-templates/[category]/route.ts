import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'
import { validateFieldSchema, findBlockedRenames } from '@/lib/sku-category-template-validation'

// ---------- PATCH: owner edits a category's display name / SKU code format / fields ----------
// `category` itself is immutable (join key across sku_master, purchases, and several
// hardcoded lists -- see docs/decisions.md) -- only display_name, sku_code_format, and
// field_schema (fields add/edit/reorder/remove, variant_fields membership) can change.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ category: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { category } = await params
  const body = await req.json()

  const { data: existing, error: fetchErr } = await supabaseAdmin
    .from('sku_category_templates')
    .select('*')
    .eq('category', category)
    .maybeSingle()
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 })
  if (!existing) return NextResponse.json({ error: 'Category not found.' }, { status: 404 })

  const updates: Record<string, any> = {}

  if (body.display_name !== undefined) {
    const displayName = String(body.display_name).trim()
    if (!displayName) return NextResponse.json({ error: 'Display name cannot be empty.' }, { status: 400 })
    updates.display_name = displayName
  }

  if (body.sku_code_format !== undefined) {
    updates.sku_code_format = String(body.sku_code_format).trim() || `SKU-${category}-{brand}-{model}`
  }

  if (body.field_schema !== undefined) {
    const schemaError = validateFieldSchema(body.field_schema)
    if (schemaError) return NextResponse.json({ error: schemaError }, { status: 400 })

    const oldFields = existing.field_schema?.fields || []
    const blockedRenames = findBlockedRenames(oldFields, body.field_schema.fields || [])
    if (blockedRenames.length > 0) {
      return NextResponse.json(
        { error: `Cannot rename existing field(s): ${blockedRenames.join(', ')}. Remove and add a new field instead.` },
        { status: 400 }
      )
    }

    updates.field_schema = body.field_schema
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update.' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('sku_category_templates')
    .update(updates)
    .eq('category', category)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAuditEvent({
    actor: { id: sessionUser!.id, email: sessionUser!.email, role: sessionUser!.role },
    actionType: 'update',
    module: 'settings',
    tableName: 'sku_category_templates',
    recordId: data.id,
    recordLabel: `${data?.display_name ?? category} (${category})`,
    metadata: updates,
  })

  return NextResponse.json(data)
}
