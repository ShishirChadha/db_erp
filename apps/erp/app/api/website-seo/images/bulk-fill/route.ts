import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'
import { stripPlaceholderSegments } from '@db/shared'

// Gives every published product photo that has no alt text a safe default:
// "<product name> - photo N of M". It describes nothing the photo might not
// show (no "front view" guesses); the owner can refine any of them afterwards.
// Never overwrites alt text that already exists. POST { dry_run: true } only counts.
export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  const { dry_run } = (await req.json().catch(() => ({}))) as { dry_run?: boolean }

  const { data, error } = await supabaseAdmin
    .from('product_images')
    .select('id, sku_id, alt_text, is_primary, sort_order, sku_master!inner(full_sku_code, brand, model_name, web_title, is_published)')
    .eq('sku_master.is_published', true)
    .order('is_primary', { ascending: false })
    .order('sort_order', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const bySku = new Map<string, any[]>()
  for (const row of data ?? []) {
    const list = bySku.get(row.sku_id) ?? []
    list.push(row)
    bySku.set(row.sku_id, list)
  }

  const updates: { id: string; alt: string }[] = []
  for (const rows of bySku.values()) {
    rows.forEach((row, i) => {
      if (row.alt_text && row.alt_text.trim()) return
      const sku = Array.isArray(row.sku_master) ? row.sku_master[0] : row.sku_master
      const name =
        (sku.web_title ? stripPlaceholderSegments(sku.web_title) : '') ||
        [sku.brand, sku.model_name].filter(Boolean).join(' ') ||
        sku.full_sku_code
      const suffix = rows.length > 1 ? ` - photo ${i + 1} of ${rows.length}` : ''
      updates.push({ id: row.id, alt: (name.slice(0, 120 - suffix.length) + suffix).trim() })
    })
  }

  if (dry_run) return NextResponse.json({ would_update: updates.length })

  let updated = 0
  for (let i = 0; i < updates.length; i += 25) {
    const results = await Promise.all(
      updates.slice(i, i + 25).map((u) =>
        // The empty-alt guard repeats in SQL so a photo someone just edited is never overwritten.
        supabaseAdmin.from('product_images').update({ alt_text: u.alt }).eq('id', u.id).or('alt_text.is.null,alt_text.eq.')
      )
    )
    updated += results.filter((r) => !r.error).length
  }

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'update',
    module: 'settings',
    tableName: 'product_images',
    recordLabel: 'Bulk alt-text fill',
    metadata: { updated, attempted: updates.length },
  })
  return NextResponse.json({ updated })
}
