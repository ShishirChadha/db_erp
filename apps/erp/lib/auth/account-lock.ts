import { randomBytes, randomUUID } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase/service'

// profiles.is_active only stops the ERP and RLS. The Auth login has to be closed too,
// or the old password and sign-ins keep working and come back on reactivation.
export async function lockAccount(id: string): Promise<string | null> {
  const { error } = await supabaseAdmin.auth.admin.updateUserById(id, {
    ban_duration: '876000h',
    password: randomBytes(32).toString('base64url'),
  })
  if (error) return error.message
  const results = await Promise.all([
    supabaseAdmin.from('user_sessions')
      .update({ revoked_at: new Date().toISOString(), revoked_reason: 'offboarded' })
      .eq('profile_id', id).is('revoked_at', null),
    supabaseAdmin.from('profiles')
      .update({ encrypted_password: null, calendar_feed_token: randomUUID() })
      .eq('id', id),
    supabaseAdmin.from('staff').update({ is_active: false }).eq('profile_id', id),
  ])
  return results.find((r) => r.error)?.error?.message ?? null
}

// The old password stays dead: the owner has to set a new one.
export async function unlockAccount(id: string): Promise<string | null> {
  const { error } = await supabaseAdmin.auth.admin.updateUserById(id, { ban_duration: 'none' })
  if (error) return error.message
  const { error: staffErr } = await supabaseAdmin.from('staff').update({ is_active: true }).eq('profile_id', id)
  return staffErr?.message ?? null
}
