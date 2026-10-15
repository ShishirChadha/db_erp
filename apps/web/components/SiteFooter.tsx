import Image from 'next/image'
import Link from 'next/link'
import { categoryToSlug, CATEGORY_SLUGS } from '@/lib/categories'
import { categoryPluralLabel } from '@/lib/seo'
import { getCategoryProductCounts } from '@/lib/queries'
import { NewsletterForm } from './NewsletterForm'
import { getSiteProfile } from '@/lib/site-profile'

// Whole machines first, then everything else; only categories that currently
// have published products are linked, so no empty page is ever advertised.
const SHOP_ORDER = ['LAP', 'DES', 'MON', 'TAB', 'ACC', 'ADP', 'RAM', 'SSD', 'KBD', 'MOUSE', 'CPU', 'GPU', 'CCTV', 'OTHER']

const SOCIAL_ICONS = [
  {
    label: 'Instagram',
    key: 'instagram' as const,
    icon: (
      <>
        <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="17" cy="7" r="0.6" fill="currentColor" stroke="none" />
      </>
    ),
  },
  {
    label: 'Facebook',
    key: 'facebook' as const,
    icon: <path d="M14 8.5h2V5h-2a4 4 0 00-4 4v2H8.5v3.5H10V21h3.5v-6.5H16l.5-3.5h-3V9a.5.5 0 01.5-.5z" />,
  },
  {
    label: 'LinkedIn',
    key: 'linkedin' as const,
    icon: (
      <>
        <rect x="3.5" y="3.5" width="17" height="17" rx="2.5" />
        <path d="M7.8 10v6.5M7.8 7.6v.01M11.5 16.5V10M11.5 12.8c0-1.5 1-2.8 2.5-2.8s2.5 1 2.5 2.8v3.7" />
      </>
    ),
  },
]

export async function SiteFooter() {
  const [counts, profile] = await Promise.all([getCategoryProductCounts(), getSiteProfile()])
  const SHOP_LINKS = SHOP_ORDER.filter((code) => code in CATEGORY_SLUGS && (counts[code] ?? 0) > 0).map((code) => ({
    code,
    label: categoryPluralLabel(code, code),
  }))
  return (
    <footer id="site-footer" className="mt-16 border-t border-border bg-secondary/40">
      <div className="border-b border-border">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-4 px-4 py-8 sm:flex-row sm:items-center sm:px-6 lg:px-8">
          <div>
            <p className="font-heading text-base font-bold text-foreground">Get deals in your inbox</p>
            <p className="text-sm text-muted-foreground">New arrivals and price drops, no spam.</p>
          </div>
          <NewsletterForm />
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-5">
          <div className="col-span-2 sm:col-span-2">
            <Link href="/" className="flex items-center gap-2">
              <Image src="/dbz-mark.png" alt="" width={26} height={26} className="h-[26px] w-[26px]" />
              <span className="font-heading text-base font-bold text-foreground">
                Digital<span className="text-brand-orange">Bluez</span>
              </span>
            </Link>
            <p className="mt-3 max-w-xs text-sm text-muted-foreground">
              {profile.addressLines.map((line) => (
                <span key={line} className="block">{line}</span>
              ))}
            </p>
            <p className="mt-3 text-sm text-muted-foreground">
              <a href={`tel:${profile.phoneTel}`} className="hover:text-brand-orange">{profile.phoneDisplay}</a>
              <span className="mx-1.5">·</span>
              <a href={`mailto:${profile.email}`} className="hover:text-brand-orange">{profile.email}</a>
            </p>
            <div className="mt-4 flex items-center gap-3">
              {SOCIAL_ICONS.filter((s) => profile.social[s.key]).map((s) => (
                <a
                  key={s.label}
                  href={profile.social[s.key] as string}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={s.label}
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:border-brand-orange hover:text-brand-orange"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                    {s.icon}
                  </svg>
                </a>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-3 text-sm font-semibold text-foreground">Shop</p>
            <ul className="space-y-2 text-sm text-muted-foreground">
              {SHOP_LINKS.map((c) => (
                <li key={c.code}>
                  <Link href={`/${categoryToSlug(c.code)}`} className="hover:text-brand-orange">
                    {c.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="mb-3 text-sm font-semibold text-foreground">Company</p>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>
                <Link href="/about" className="hover:text-brand-orange">Our story</Link>
              </li>
              <li>
                <Link href="/contact" className="hover:text-brand-orange">Contact us</Link>
              </li>
              <li>
                <Link href="/blog" className="hover:text-brand-orange">Blog</Link>
              </li>
              <li>
                <Link href="/faq" className="hover:text-brand-orange">FAQ</Link>
              </li>
              <li>
                <a href={`https://wa.me/${profile.whatsappNumber}`} target="_blank" rel="noopener noreferrer" className="hover:text-brand-orange">
                  Bulk / business orders
                </a>
              </li>
            </ul>
          </div>
          <div>
            <p className="mb-3 text-sm font-semibold text-foreground">Policies</p>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>
                <Link href="/warranty" className="hover:text-brand-orange">Warranty Policy</Link>
              </li>
              <li>
                <Link href="/replacement-policy" className="hover:text-brand-orange">Replacement Policy</Link>
              </li>
              <li>
                <Link href="/shipping-policy" className="hover:text-brand-orange">Shipping &amp; Delivery</Link>
              </li>
              <li>
                <Link href="/buyback" className="hover:text-brand-orange">Trade-in</Link>
              </li>
              <li>
                <Link href="/terms" className="hover:text-brand-orange">Terms &amp; Conditions</Link>
              </li>
              <li>
                <Link href="/privacy" className="hover:text-brand-orange">Privacy Policy</Link>
              </li>
            </ul>
          </div>
        </div>
        <div className="mt-10 flex flex-col gap-2 border-t border-border pt-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} DigitalBluez. All rights reserved.</p>
          <p>
            Grievance Officer: {profile.grievance.name} ·{' '}
            <a href={`mailto:${profile.grievance.email}`} className="hover:text-brand-orange">{profile.grievance.email}</a>
          </p>
        </div>
      </div>
    </footer>
  )
}
