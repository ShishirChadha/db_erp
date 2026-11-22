import { supabaseAdmin } from '@/lib/supabase/service'
import { getAssistantSettings } from './settings'
import { DB_USERNAME } from './identity'

// DB's blanket expense approval (Settings -> DB Assistant -> What DB can do).
// DB's own login is a manager, which the Expenses route would refuse for
// owner-only (private) expense types. The owner can let her record those
// anyway: she acts only for her master, every save goes through his confirm
// card, and her token never leaves the server. Staff still never see these
// types or rows -- the Expenses GET filters them by type for every non-owner.
export async function dbMayUsePrivateExpenseTypes(userId: string): Promise<boolean> {
  const settings = await getAssistantSettings()
  if (!settings.expense_full_access) return false
  const { data } = await supabaseAdmin.from('profiles').select('username').eq('id', userId).maybeSingle()
  return data?.username === DB_USERNAME
}

// Accounts that other owners must not change (2026-11-22 security review):
// - DB's master (the owner DB answers to): any owner could otherwise reset the
//   master's password, sign in as them and use DB -- or change their role or
//   deactivate them. Only the master changes their own account.
// - DB's own account: nobody may view or reset her password (only the server
//   signs her in) or change her role; everything else (activate/deactivate, page
//   access) only a master may change.
// `locked`: the caller may change nothing. `db`: the caller is a master looking
// at DB -- password and role stay locked, the off switch and access stay theirs.
export type AccountProtection = 'locked' | 'db' | null
export async function dbMasterIds(): Promise<string[]> {
  return (await getAssistantSettings()).master_profile_ids
}
export function accountProtection(target: { id: string; username: string | null }, callerId: string, masters: string[]): AccountProtection {
  if (target.username === DB_USERNAME) return masters.includes(callerId) ? 'db' : 'locked'
  if (masters.includes(target.id) && target.id !== callerId) return 'locked'
  return null
}
export const PROTECTED_MESSAGE = {
  locked: 'This account is protected: only DB’s master can change it.',
  db: 'DB’s password and role are managed by the ERP and can’t be viewed or changed.',
} as const
