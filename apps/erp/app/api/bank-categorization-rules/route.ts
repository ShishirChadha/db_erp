import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'

// ---------- GET: list rules (optionally scoped to one account, plus global ones) ----------
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const bankAccountId = searchParams.get('bank_account_id')

  let query = supabaseAdmin.from('bank_categorization_rules').select('*').order('created_at', { ascending: false })
  if (bankAccountId) query = query.or(`bank_account_id.eq.${bankAccountId},bank_account_id.is.null`)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// ---------- POST: save "always treat this narration as X" -- the learn-once step ----------
// After the owner categorizes one transaction by hand, the review UI offers this to
// save the pattern -- every future narration containing it can then auto-categorize
// (auto_apply=true) instead of prompting again.
export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json()
  const { bank_account_id, narration_pattern, category, auto_apply } = body
  if (!narration_pattern?.trim() || !category?.trim()) {
    return NextResponse.json({ error: 'narration_pattern and category are required.' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('bank_categorization_rules')
    .insert({ bank_account_id: bank_account_id || null, narration_pattern: narration_pattern.trim(), category: category.trim(), auto_apply: !!auto_apply, created_by: sessionUser.id })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
