// Service-role Supabase client for build-tooling scripts (scripts/bible/**). Deliberately
// separate from apps/erp/lib/supabase/service.ts -- that shim is app-runtime code bundled
// by Next.js; these scripts run standalone via `tsx` from the repo root and need their own
// env loading (apps/erp/.env.local, since that's where the working ERP's credentials live).
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const envPath = resolve(__dirname, '../../../apps/erp/.env.local')
if (existsSync(envPath)) config({ path: envPath, quiet: true })

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !serviceKey) {
  throw new Error(
    'Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY -- expected them in apps/erp/.env.local'
  )
}

export const supabaseAdmin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

export const SUPABASE_URL = url
export const SUPABASE_SERVICE_KEY = serviceKey
