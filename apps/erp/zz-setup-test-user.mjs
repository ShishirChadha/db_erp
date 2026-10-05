import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const env = fs.readFileSync('/Users/shishirchadha/Documents/db_erp/apps/erp/.env.local', 'utf8')
const get = (k) => env.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]?.trim()
const SUPABASE_URL = get('NEXT_PUBLIC_SUPABASE_URL')
const SERVICE_KEY = get('SUPABASE_SERVICE_ROLE_KEY')

const admin = createClient(SUPABASE_URL, SERVICE_KEY)
export const TEST_EMAIL = 'zz-diag-employee@test.internal'
export const TEST_PASS = 'DiagTest12345!'

async function main() {
  const { data: existingList } = await admin.auth.admin.listUsers()
  const stale = existingList.users.find(u => u.email === TEST_EMAIL)
  if (stale) {
    await admin.from('profiles').delete().eq('id', stale.id)
    await admin.auth.admin.deleteUser(stale.id)
  }

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: TEST_EMAIL, password: TEST_PASS, email_confirm: true,
  })
  if (createErr) throw createErr
  const uid = created.user.id

  const { error: profErr } = await admin.from('profiles').insert({
    id: uid, role: 'employee', is_active: true, allowed_pages: ['activities', 'live_stock'],
  })
  if (profErr) throw profErr

  console.log('TEST_USER_ID=' + uid)
}

main().catch(e => { console.error(e); process.exit(1) })
