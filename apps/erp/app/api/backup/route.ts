import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { parsePagination } from '@/lib/pagination'

// Metadata-only history list -- never selects `payload` (can be several MB per row).
const LIST_COLUMNS = 'id, created_at, created_by, trigger_type, modules, row_counts, status, error_message, downloaded_at, size_bytes'

export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const pagination = parsePagination(searchParams)

  let query = supabaseAdmin.from('backup_snapshots').select(LIST_COLUMNS, pagination ? { count: 'exact' } : undefined).order('created_at', { ascending: false })
  if (pagination) query = query.range(pagination.from, pagination.to)

  const { data, error, count } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (pagination) return NextResponse.json({ data, total: count ?? 0 })
  return NextResponse.json(data)
}
