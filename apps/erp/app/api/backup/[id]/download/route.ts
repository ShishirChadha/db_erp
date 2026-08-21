import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const { data: row, error } = await supabaseAdmin
    .from('backup_snapshots')
    .select('payload, created_at, trigger_type, status')
    .eq('id', id)
    .single()

  if (error || !row) return NextResponse.json({ error: 'Backup not found' }, { status: 404 })
  if (row.status !== 'complete') return NextResponse.json({ error: 'Backup did not complete successfully' }, { status: 409 })

  // First-download-wins -- doesn't reset the "new" indicator on re-download.
  await supabaseAdmin.from('backup_snapshots').update({ downloaded_at: new Date().toISOString() }).eq('id', id).is('downloaded_at', null)

  const stamp = new Date(row.created_at).toISOString().replace(/[:.]/g, '-')
  const filename = `erp-backup-${row.trigger_type}-${stamp}-${id.slice(0, 8)}.json`

  return new NextResponse(JSON.stringify(row.payload), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
