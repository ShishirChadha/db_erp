import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { normalizeSpecifications } from '@/lib/sku-normalizer'
import { canonicalJson } from '@/lib/sku-resolver'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { redactForRole } from '@/lib/auth/redact'
import { logFieldCorrections } from '@/lib/field-corrections'

// ---------- GET (detail) ----------
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const { data: sku, error } = await supabaseAdmin
    .from('sku_master')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !sku) return NextResponse.json({ error: 'SKU not found' }, { status: 404 })
  return NextResponse.json(redactForRole(sku, 'sku_master', sessionUser.role))
}

// ---------- PUT (update) ----------
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

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
    'hsn_code',
    'category',
    'status',
    // Web-publishing fields (see docs/decisions.md, 2026-07-28)
    'is_published',
    'web_price',
    'market_price',
    'web_slug',
    'web_title',
    'web_description',
    'web_highlights',
    'web_condition_grade',
  ]
  const updatable: any = {}
  for (const key of allowedKeys) {
    if (body[key] !== undefined) updatable[key] = body[key]
  }

  // published_at is server-set, never client-supplied -- mirrors completed_at/
  // reviewed_at elsewhere in this codebase (a timestamp that's a side-effect of
  // a state transition, not an independently editable field).
  if ('is_published' in updatable) {
    const { data: current } = await supabaseAdmin
      .from('sku_master')
      .select('is_published')
      .eq('id', id)
      .single()
    if (updatable.is_published && !current?.is_published) {
      updatable.published_at = new Date().toISOString()
    } else if (!updatable.is_published) {
      updatable.published_at = null
    }
  }

  // If specifications are being updated, normalize them first
  if (updatable.specifications !== undefined) {
    // Get the SKU's category to know which normalization rules to apply
    const { data: sku } = await supabaseAdmin
      .from('sku_master')
      .select('category, base_sku_code')
      .eq('id', id)
      .single()

    if (sku) {
      updatable.specifications = await normalizeSpecifications(sku.category, updatable.specifications)

      // Guard against silently creating a duplicate: if another existing SKU
      // (same base code, different id) already has these exact normalized specs,
      // reject the edit rather than saving a second row with identical specs.
      // Correcting a mistaken SKU to match one that already exists should be done
      // by reassigning the affected assets to that existing SKU (Stock view's
      // "Fix SKU" action), not by editing this row's specs in place.
      const { data: candidates } = await supabaseAdmin
        .from('sku_master')
        .select('id, full_sku_code, specifications')
        .eq('base_sku_code', sku.base_sku_code)
        .neq('id', id)

      const newSpecsNorm = canonicalJson(updatable.specifications)
      const duplicate = (candidates || []).find(
        (c) => canonicalJson(c.specifications) === newSpecsNorm
      )
      if (duplicate) {
        return NextResponse.json(
          {
            error: `These specs match existing SKU ${duplicate.full_sku_code}. Use "Fix SKU" on the affected assets to reassign them there instead of editing this SKU's specs.`,
          },
          { status: 409 }
        )
      }
    }
  }

  if (Object.keys(updatable).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  const { data: before } = await supabaseAdmin
    .from('sku_master')
    .select(Object.keys(updatable).join(','))
    .eq('id', id)
    .single()

  const { data, error } = await supabaseAdmin
    .from('sku_master')
    .update(updatable)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  if (before) {
    await logFieldCorrections(
      'sku_master',
      id,
      Object.keys(updatable).map((field) => ({
        field,
        oldValue: typeof (before as any)[field] === 'object' ? JSON.stringify((before as any)[field]) : (before as any)[field],
        newValue: typeof updatable[field] === 'object' ? JSON.stringify(updatable[field]) : updatable[field],
      })),
      sessionUser.id
    )
  }

  return NextResponse.json(data)
}

// ---------- DELETE (soft delete) ----------
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

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