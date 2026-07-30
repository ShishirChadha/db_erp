import Image from 'next/image'
import Link from 'next/link'
import { categoryToSlug } from '@/lib/categories'
import { getCustomerSession } from '@/lib/customer-session'
import { createServerSupabaseClient } from '@db/db/server'

const NAV_CATEGORIES = [
  { code: 'LAP', label: 'Laptops' },
  { code: 'DES', label: 'Desktops' },
  { code: 'MON', label: 'Monitors' },
  { code: 'TAB', label: 'Tablets' },
  { code: 'ACC', label: 'Accessories' },
]

async function getCartCount(customerId: string | null): Promise<number> {
  if (!customerId) return 0
  const supabase = await createServerSupabaseClient()
  const { count } = await supabase
    .from('cart_items')
    .select('id', { count: 'exact', head: true })
    .eq('customer_id', customerId)
  return count ?? 0
}

export async function SiteHeader() {
  const session = await getCustomerSession()
  const cartCount = await getCartCount(session?.id ?? null)

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
      <div className="hidden bg-foreground text-background sm:block">
        <div className="mx-auto flex max-w-6xl items-center justify-center gap-6 px-4 py-1.5 text-xs font-medium sm:px-6 lg:px-8">
          <span>Every unit quality-checked &amp; backed by warranty</span>
          <span className="h-1 w-1 rounded-full bg-background/40" />
          <span>Secure Razorpay checkout</span>
        </div>
      </div>
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3 sm:px-6 lg:px-8">
        <Link href="/" className="flex shrink-0 items-center gap-2">
          <Image src="/dbz-mark.png" alt="" width={30} height={30} className="h-[30px] w-[30px]" priority />
          <span className="font-heading text-lg font-bold tracking-tight text-foreground">
            Digital<span className="text-brand-orange">Bluez</span>
          </span>
        </Link>
        <nav className="hidden flex-1 items-center gap-5 md:flex">
          {NAV_CATEGORIES.map((c) => (
            <Link
              key={c.code}
              href={`/${categoryToSlug(c.code)}`}
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-brand-orange"
            >
              {c.label}
            </Link>
          ))}
        </nav>
        <form action="/search" className="ml-auto flex w-full max-w-xs items-center">
          <input
            type="search"
            name="q"
            placeholder="Search laptops, brands..."
            className="w-full rounded-full border border-input bg-background px-3.5 py-1.5 text-sm outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/30"
          />
        </form>
        <Link
          href="/cart"
          className="relative shrink-0 text-muted-foreground transition-colors hover:text-brand-orange"
          aria-label="Cart"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
            <path d="M5 9h14l-1.2 9.5a2 2 0 01-2 1.5H8.2a2 2 0 01-2-1.5L5 9z" />
            <path d="M8 9V6.5a4 4 0 018 0V9" />
          </svg>
          {cartCount > 0 && (
            <span className="absolute -right-2 -top-2 flex h-4 w-4 items-center justify-center rounded-full bg-brand-orange text-[10px] font-bold text-white">
              {cartCount}
            </span>
          )}
        </Link>
        {session ? (
          <Link href="/account" className="shrink-0 text-sm font-medium text-muted-foreground hover:text-brand-orange">
            {session.fullName?.split(' ')[0] || 'Account'}
          </Link>
        ) : (
          <Link
            href="/login"
            className="shrink-0 rounded-full bg-foreground px-3.5 py-1.5 text-sm font-semibold text-background transition-opacity hover:opacity-90"
          >
            Log in
          </Link>
        )}
      </div>
    </header>
  )
}
