import Image from 'next/image'
import Link from 'next/link'
import { categoryToSlug, NAV_CATEGORIES } from '@/lib/categories'
import { HeaderAccountState } from './HeaderAccountState'
import { HeaderSearch } from './HeaderSearch'
import { AccessoriesNavGroup } from './AccessoriesNavGroup'
import { MobileNav } from './MobileNav'

// No cookie/session reads here -- account state and cart count are fetched
// client-side by HeaderAccountState after hydration, so this component (and
// the root layout it sits in) stays static and every storefront page under
// it remains ISR-eligible instead of opting into full dynamic rendering.
export function SiteHeader() {
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
        <MobileNav />
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
          <AccessoriesNavGroup />
        </nav>
        <HeaderSearch />
        <HeaderAccountState />
      </div>
    </header>
  )
}
