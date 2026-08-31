import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'

// ---------- GET: list proposals, grouped by vendor for the review page ----------
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const documentId = searchParams.get('document_id')
  const status = searchParams.get('status') || 'pending'

  let query = supabaseAdmin
    .from('vendor_correction_proposals')
    .select('*, vendors(company_name), uploaded_documents(file_name, document_date)')
    .order('created_at', { ascending: false })
  if (documentId) query = query.eq('document_id', documentId)
  if (status !== 'all') query = query.eq('status', status)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
