import { createServerSupabaseClient } from '@db/db/server'
import { supabaseAdmin } from '@db/db/admin'

export interface CustomerSession {
  id: string
  email: string | null
  customerId: string
  fullName: string | null
}

// Server-side session for the storefront's customer accounts -- distinct
// from the ERP's staff getSessionUser/getCookieSessionUser. A person with
// only a staff `profiles` row (no customer_profiles row) is not a customer
// session here, and vice versa -- the two identities are never conflated.
export async function getCustomerSession(): Promise<CustomerSession | null> {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabaseAdmin
    .from('customer_profiles')
    .select('customer_id, full_name')
    .eq('id', user.id)
    .single()
  if (!profile) return null

  return {
    id: user.id,
    email: user.email ?? null,
    customerId: profile.customer_id,
    fullName: profile.full_name,
  }
}
