import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createServerSupabaseClient() {
  const cookieStore = await cookies()

  // Must match browser.ts's cookie name exactly, or this server-side client
  // reads/writes a different cookie than the one the browser client actually
  // uses -- see browser.ts for why apps/erp and apps/web each need their own.
  const cookieName = process.env.NEXT_PUBLIC_SUPABASE_COOKIE_NAME
  const cookieOptions = cookieName ? { name: cookieName } : undefined

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions,
      cookies: {
        // Read only – safe in Server Components
        getAll() {
          return cookieStore.getAll()
        },
        // Write only – will be used in Server Actions and Route Handlers
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch (error) {
            // In a Server Component, this will throw. That's fine – we don't write.
            // We only write in Server Actions or Route Handlers.
          }
        },
      },
    }
  )
}
