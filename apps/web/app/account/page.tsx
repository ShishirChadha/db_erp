import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getCustomerSession } from '@/lib/customer-session'
import { LogoutButton } from '@/components/LogoutButton'

export default async function AccountPage() {
  const session = await getCustomerSession()
  if (!session) redirect('/login?next=/account')

  return (
    <main className="mx-auto max-w-lg px-4 py-14 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">My account</h1>
      <div className="mt-6 rounded-md border border-border p-4 text-sm">
        <p><span className="text-muted-foreground">Name:</span> {session.fullName || '—'}</p>
        <p className="mt-1"><span className="text-muted-foreground">Email:</span> {session.email}</p>
      </div>
      <div className="mt-6 flex items-center justify-between">
        <div className="flex gap-4">
          <Link href="/account/orders" className="text-sm font-medium text-foreground underline">
            Order history
          </Link>
          <Link href="/account/wishlist" className="text-sm font-medium text-foreground underline">
            Wishlist
          </Link>
        </div>
        <LogoutButton />
      </div>
    </main>
  )
}
