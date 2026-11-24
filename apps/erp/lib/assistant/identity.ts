import { randomBytes } from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabase/service'
import { encryptPassword, decryptPassword } from '@/lib/auth/password-vault'
import { usernameToSyntheticEmail } from '@/lib/auth/username'
import { getAssistantSettings, type WriteSkill } from './settings'

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
// DB's login is used only by the server (setUpDbAgent creates her session
// directly). The browser login routes refuse it, so even someone who somehow
// had her password couldn't open the ERP as "DB".
export const DB_BROWSER_LOGIN_MESSAGE = 'The DB assistant account can’t sign in from a browser.'
export async function isDbAgent(userId: string): Promise<boolean> {
  const { data } = await supabaseAdmin.from('profiles').select('username').eq('id', userId).maybeSingle()
  return data?.username === DB_USERNAME
}
const SESSION_SETTING_KEY = 'assistant_db_session_id'

// DB's ERP access follows her skills (Settings -> DB Assistant -> What DB can
// do): each switched-on skill gets exactly the page grants its route checks,
// nothing more, and switching a skill off takes them away. Her reads don't use
// page grants (they run on the server), so a skill with no route needs none.
// Before 2026-11-24 her access was also editable in Users, which let it drift
// far wider than anything she could use -- Users now shows it read-only.
//   view = profiles.allowed_pages (hasPageAccess), edit = profile_page_actions (canEditPage)
export const SKILL_PAGES: Record<WriteSkill, { view: string[]; edit: string[] }> = {
  pi: { view: ['quotations'], edit: ['quotations'] },           // POST /api/sales-documents
  expense: { view: ['expenses'], edit: ['expenses'] },          // POST /api/expenses
  sale: { view: ['new_entry'], edit: [] },                      // POST /api/sales-entry
  repair: { view: ['new_entry'], edit: [] },                    // POST /api/repair-jobs
  replacement: { view: ['new_entry'], edit: [] },               // POST /api/replacement-jobs
  stock_in: { view: ['new_entry'], edit: [] },                  // POST /api/stock-intake + accessory receive
  trade_in: { view: ['new_entry'], edit: [] },                  // POST /api/trade-ins
  return: { view: ['rma'], edit: ['rma'] },                     // POST /api/rma (from_customer)
  customer: { view: [], edit: [] },                             // saved by the assistant itself
  learn: { view: [], edit: [] },
}
const PAGE_NAMES: Record<string, string> = { quotations: 'PIs & Quotations', expenses: 'Expenses', new_entry: 'New Entry', rma: 'RMA' }

export function dbPageGrants(skills: readonly WriteSkill[]) {
  const view = [...new Set(skills.flatMap((k) => SKILL_PAGES[k]?.view ?? []))].sort()
  const edit = [...new Set(skills.flatMap((k) => SKILL_PAGES[k]?.edit ?? []))].sort()
  return { view, edit }
}

export function skillPagesLine(skill: WriteSkill) {
  const { view, edit } = SKILL_PAGES[skill]
  if (!view.length) return 'It needs no extra ERP page access.'
  return `ERP access it gets: ${view.map((k) => `${PAGE_NAMES[k] || k}${edit.includes(k) ? ' (edit)' : ''}`).join(', ')}.`
}

// Sets DB's page grants to exactly what these skills need. Called when her
// skills change (Settings save, the Allow card) and when her account is made.
export async function syncDbPageGrants(skills: readonly WriteSkill[]): Promise<void> {
  const { data: profile } = await supabaseAdmin.from('profiles').select('id').eq('username', DB_USERNAME).maybeSingle()
  if (!profile) return
  const { view, edit } = dbPageGrants(skills)
  const { error } = await supabaseAdmin.from('profiles').update({ allowed_pages: view }).eq('id', profile.id)
  if (error) throw new Error(`Could not update DB's page access: ${error.message}`)
  const { error: delErr } = await supabaseAdmin.from('profile_page_actions').delete().eq('profile_id', profile.id)
  if (delErr) throw new Error(`Could not update DB's edit access: ${delErr.message}`)
  if (edit.length) {
    const { error: insErr } = await supabaseAdmin.from('profile_page_actions')
      .insert(edit.map((page_key) => ({ profile_id: profile.id, page_key, can_edit: true })))
    if (insErr) throw new Error(`Could not update DB's edit access: ${insErr.message}`)
  }
}

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
      allowed_pages: [],
      username: DB_USERNAME,
      encrypted_password: encryptPassword(password),
    })
    if (profileErr) {
      await supabaseAdmin.auth.admin.deleteUser(created.user.id)
      throw new Error(profileErr.message)
    }
    await syncDbPageGrants((await getAssistantSettings()).write_skills)
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
