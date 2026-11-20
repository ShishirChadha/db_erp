import { randomBytes } from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabase/service'
import { encryptPassword, decryptPassword } from '@/lib/auth/password-vault'
import { usernameToSyntheticEmail } from '@/lib/auth/username'

// DB is a real ERP user, so everything she creates is attributed to her
// (created_by / entered_by / audit actor) -- the owner asked to be able to see
// "what work was done by her". She is a manager, not an owner: owners receive
// owner-only alerts and emails and can manage users, which a bot must not.
//
// She acts through the same route handlers staff use (lib/assistant/call-route.ts)
// with her own access token and her own device session, so:
//   - permissions are her page grants below, nothing more;
//   - the office-only login rule is satisfied by her device session cookie;
//   - logging her off in Settings -> Active Devices, or deactivating her in
//     Users, stops her at once. That is the off switch.
export const DB_USERNAME = 'db'
export const DB_DISPLAY_NAME = 'DB'
const SESSION_SETTING_KEY = 'assistant_db_session_id'

// Only the screens her tasks need. Edit grants are the subset that gate writes
// (sales entry and repair creation are gated by page access alone).
export const DB_ALLOWED_PAGES = ['new_entry', 'quotations', 'expenses', 'repair_jobs', 'replacement_jobs', 'customers', 'live_stock', 'stock']
export const DB_EDIT_PAGES = ['quotations', 'expenses', 'repair_jobs', 'replacement_jobs', 'customers']

export type DbAgentStatus =
  | { ready: true; profileId: string; sessionId: string }
  | { ready: false; reason: 'not_set_up' | 'deactivated' | 'logged_off' }

export async function getDbAgentStatus(): Promise<DbAgentStatus> {
  const { data: profile } = await supabaseAdmin
    .from('profiles').select('id, is_active').eq('username', DB_USERNAME).maybeSingle()
  if (!profile) return { ready: false, reason: 'not_set_up' }
  if (!profile.is_active) return { ready: false, reason: 'deactivated' }

  const { data: setting } = await supabaseAdmin.from('app_settings').select('value').eq('key', SESSION_SETTING_KEY).maybeSingle()
  if (!setting?.value) return { ready: false, reason: 'logged_off' }
  const { data: session } = await supabaseAdmin
    .from('user_sessions').select('revoked_at, profile_id').eq('id', setting.value).maybeSingle()
  if (!session || session.revoked_at || session.profile_id !== profile.id) return { ready: false, reason: 'logged_off' }
  return { ready: true, profileId: profile.id, sessionId: setting.value }
}

// Creates DB's account if missing, and gives her a fresh device session if she
// has none (first setup, or after the owner logged her off and now wants her
// back). Never touches an account the owner deactivated -- that is theirs to undo
// in Users.
export async function setUpDbAgent(): Promise<DbAgentStatus> {
  let { data: profile } = await supabaseAdmin
    .from('profiles').select('id, is_active').eq('username', DB_USERNAME).maybeSingle()

  if (!profile) {
    const password = randomBytes(24).toString('base64url')
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: usernameToSyntheticEmail(DB_USERNAME), password, email_confirm: true,
    })
    if (error || !created.user) throw new Error(error?.message || 'Could not create DB\'s login.')
    const { error: profileErr } = await supabaseAdmin.from('profiles').insert({
      id: created.user.id,
      full_name: DB_DISPLAY_NAME,
      role: 'manager',
      is_active: true,
      allowed_pages: DB_ALLOWED_PAGES,
      username: DB_USERNAME,
      encrypted_password: encryptPassword(password),
    })
    if (profileErr) {
      await supabaseAdmin.auth.admin.deleteUser(created.user.id)
      throw new Error(profileErr.message)
    }
    await supabaseAdmin.from('profile_page_actions')
      .insert(DB_EDIT_PAGES.map((page_key) => ({ profile_id: created.user.id, page_key, can_edit: true })))
    profile = { id: created.user.id, is_active: true }
  }
  if (!profile.is_active) return { ready: false, reason: 'deactivated' }

  const current = await getDbAgentStatus()
  if (current.ready) return current

  const { data: session, error: sessionErr } = await supabaseAdmin
    .from('user_sessions')
    .insert({ profile_id: profile.id, device_label: 'DB assistant (server)', user_agent: 'erp-assistant', location: 'ERP server' })
    .select('id').single()
  if (sessionErr || !session) throw new Error(sessionErr?.message || 'Could not start DB\'s session.')
  await supabaseAdmin.from('app_settings').upsert({ key: SESSION_SETTING_KEY, value: session.id }, { onConflict: 'key' })
  cachedToken = null
  return { ready: true, profileId: profile.id, sessionId: session.id }
}

// Her access token, from her stored (encrypted) password -- the same vault that
// already keeps staff passwords. Cached per server instance until shortly
// before it expires, so a turn doesn't pay a sign-in round trip.
let cachedToken: { token: string; expiresAt: number; profileId: string } | null = null

export async function getDbAccessToken(profileId: string): Promise<string> {
  if (cachedToken && cachedToken.profileId === profileId && cachedToken.expiresAt - Date.now() > 120_000) return cachedToken.token

  const { data: profile } = await supabaseAdmin.from('profiles').select('encrypted_password').eq('id', profileId).single()
  if (!profile?.encrypted_password) throw new Error('DB has no stored password -- set her up again from the assistant panel.')
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await anon.auth.signInWithPassword({
    email: usernameToSyntheticEmail(DB_USERNAME),
    password: decryptPassword(profile.encrypted_password),
  })
  if (error || !data.session) throw new Error(`DB could not sign in: ${error?.message || 'no session'}`)
  cachedToken = { token: data.session.access_token, expiresAt: (data.session.expires_at ?? 0) * 1000, profileId }
  return cachedToken.token
}
