import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { decryptPassword } from '@/lib/auth/password-vault'
import { DB_USERNAME } from '@/lib/assistant/identity'
import { PROTECTED_MESSAGE } from '@/lib/assistant/permissions'

// ---------- GET: owner views a stored (non-owner) user's current password ----------
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const { data: profile } = await supabaseAdmin
    .from('profiles').select('role, username, encrypted_password').eq('id', id).maybeSingle()

  if (!profile) return NextResponse.json({ error: 'User not found' }, { status: 404 })
  // Nobody sees DB's password: only the server signs her in, and anyone holding
  // it could act in her name.
  if (profile.username === DB_USERNAME) return NextResponse.json({ error: PROTECTED_MESSAGE.db }, { status: 403 })
  if (profile.role === 'owner') {
    return NextResponse.json({ error: 'Owner passwords cannot be viewed.' }, { status: 403 })
  }

  const password = profile.encrypted_password ? decryptPassword(profile.encrypted_password) : null
  return NextResponse.json({ password })
}
