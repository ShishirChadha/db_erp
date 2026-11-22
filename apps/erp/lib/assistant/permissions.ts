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
