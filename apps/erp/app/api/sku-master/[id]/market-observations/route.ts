import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'

// ---------- POST: log a competitor price observation for one SKU ----------
// Owner-only, matching the rest of the Price Cockpit -- these prices sit right next to
// buying cost in the same view, so the same access boundary applies even though the
// competitor's price itself isn't this business's cost data.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const body = await req.json()
  const { competitor, price, condition_grade, source_url, notes } = body

  if (!competitor || typeof competitor !== 'string' || !competitor.trim()) {
    return NextResponse.json({ error: 'Competitor is required' }, { status: 400 })
  }
  const priceNum = Number(price)
  if (!Number.isFinite(priceNum) || priceNum <= 0) {
    return NextResponse.json({ error: 'A positive price is required' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('market_price_observations')
    .insert({
      sku_id: id,
      competitor: competitor.trim(),
      price: priceNum,
      condition_grade: condition_grade || null,
      source_url: source_url || null,
      notes: notes || null,
      observed_by: sessionUser.id,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data)
}

// ---------- GET: list observations for one SKU (owner-only) ----------
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const { data, error } = await supabaseAdmin
    .from('market_price_observations')
    .select('id, competitor, price, condition_grade, source_url, notes, observed_at')
    .eq('sku_id', id)
    .eq('is_deleted', false)
    .order('observed_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data || [])
}
