import Link from 'next/link'

const ICONS: Record<string, React.ReactNode> = {
  LAP: (
    <>
      <rect x="4" y="4.5" width="16" height="10.5" rx="1.2" />
      <path d="M2.5 18.5h19l-1.2-2.5H3.7z" />
    </>
  ),
  DES: (
    <>
      <rect x="4" y="4.5" width="16" height="10.5" rx="1.2" />
      <path d="M9.5 19h5M12 15v4" />
    </>
  ),
  MON: (
    <>
      <rect x="3.5" y="4.5" width="17" height="11.5" rx="1.2" />
      <path d="M9 19.5h6M12 16v3.5" />
    </>
  ),
  TAB: (
    <>
      <rect x="6" y="3" width="12" height="18" rx="1.5" />
      <path d="M12 18h.01" />
    </>
  ),
  ACC: (
    <>
      <path d="M4 13a8 8 0 0116 0" />
      <rect x="3" y="13" width="4" height="6" rx="1.2" />
      <rect x="17" y="13" width="4" height="6" rx="1.2" />
    </>
  ),
}

export function CategoryTile({ href, code, label }: { href: string; code: string; label: string }) {
  return (
    <Link
      href={href}
      className="group flex flex-col items-center gap-3 rounded-xl border border-border bg-card px-4 py-6 text-center transition-all hover:-translate-y-0.5 hover:border-brand-orange/30 hover:shadow-md"
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-orange/10 text-brand-orange transition-colors group-hover:bg-brand-orange group-hover:text-white">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
          {ICONS[code]}
        </svg>
      </span>
      <span className="text-sm font-semibold text-foreground">{label}</span>
    </Link>
  )
}
