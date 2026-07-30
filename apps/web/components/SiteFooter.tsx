import Image from 'next/image'
import Link from 'next/link'
import { categoryToSlug } from '@/lib/categories'
import { NewsletterForm } from './NewsletterForm'
import {
  BUSINESS_ADDRESS_LINES,
  BUSINESS_PHONE_DISPLAY,
  BUSINESS_PHONE_TEL,
  BUSINESS_EMAIL,
  WHATSAPP_NUMBER,
  SOCIAL_LINKS,
} from '@/lib/business-info'

const SHOP_LINKS = [
  { code: 'LAP', label: 'Laptops' },
  { code: 'DES', label: 'Desktops' },
  { code: 'MON', label: 'Monitors' },
  { code: 'ACC', label: 'Accessories' },
]

const SOCIAL_ICONS = [
  {
    label: 'Instagram',
    href: SOCIAL_LINKS.instagram,
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
    href: SOCIAL_LINKS.facebook,
    icon: <path d="M14 8.5h2V5h-2a4 4 0 00-4 4v2H8.5v3.5H10V21h3.5v-6.5H16l.5-3.5h-3V9a.5.5 0 01.5-.5z" />,
  },
  {
    label: 'LinkedIn',
    href: SOCIAL_LINKS.linkedin,
    icon: (
      <>
        <rect x="3.5" y="3.5" width="17" height="17" rx="2.5" />
        <path d="M7.8 10v6.5M7.8 7.6v.01M11.5 16.5V10M11.5 12.8c0-1.5 1-2.8 2.5-2.8s2.5 1 2.5 2.8v3.7" />
      </>
    ),
  },
]

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-border bg-secondary/40">
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
              {BUSINESS_ADDRESS_LINES.map((line) => (
                <span key={line} className="block">{line}</span>
              ))}
            </p>
            <p className="mt-3 text-sm text-muted-foreground">
              <a href={`tel:${BUSINESS_PHONE_TEL}`} className="hover:text-brand-orange">{BUSINESS_PHONE_DISPLAY}</a>
              <span className="mx-1.5">·</span>
              <a href={`mailto:${BUSINESS_EMAIL}`} className="hover:text-brand-orange">{BUSINESS_EMAIL}</a>
            </p>
            <div className="mt-4 flex items-center gap-3">
              {SOCIAL_ICONS.map((s) => (
                <a
                  key={s.label}
                  href={s.href}
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
                <a href={`https://wa.me/${WHATSAPP_NUMBER}`} target="_blank" rel="noopener noreferrer" className="hover:text-brand-orange">
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
                <Link href="/return-policy" className="hover:text-brand-orange">Return Policy</Link>
              </li>
              <li>
                <Link href="/buyback" className="hover:text-brand-orange">Buyback Guarantee</Link>
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
          <p>One Stop IT Solutions</p>
        </div>
      </div>
    </footer>
  )
}
