// Service-role client -- bypasses RLS. Server-only: never import this into a
// 'use client' file or any code that ships to the browser.
import { createClient } from '@supabase/supabase-js'

export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)
