import { NextResponse } from 'next/server'
import { getCustomerSession } from '@/lib/customer-session'
import { createServerSupabaseClient } from '@db/db/server'

// Read by the client-side header island (components/HeaderAccountState.tsx)
// after hydration, so the cookie-bound session lookup never sits in the
// server-rendered root layout -- keeping every storefront page statically
// cacheable / ISR-eligible. This route itself stays dynamic; that's fine,
// it's an API route, not a page.
export async function GET() {
  const session = await getCustomerSession()
  if (!session) {
    return NextResponse.json({ loggedIn: false, firstName: null, cartCount: 0 })
  }

  const supabase = await createServerSupabaseClient()
  const { count } = await supabase
    .from('cart_items')
    .select('id', { count: 'exact', head: true })
    .eq('customer_id', session.id)

  return NextResponse.json({
    loggedIn: true,
    firstName: session.fullName?.split(' ')[0] || 'Account',
    cartCount: count ?? 0,
  })
}
