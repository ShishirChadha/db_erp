import Link from 'next/link'

interface PaginationProps {
  currentPage: number
  totalPages: number
  buildHref: (page: number) => string
}

// Conservative URL-based pager (?page=N) -- server component, no client JS.
// Today's catalog (~165 SKUs) barely needs this; it exists to keep listing
// pages bounded as the catalog grows. Styled with the same rounded-full
// button language used elsewhere on the storefront (LoginForm's submit
// button, ProductFilters' toggle) rather than inventing a new control.
export function Pagination({ currentPage, totalPages, buildHref }: PaginationProps) {
  if (totalPages <= 1) return null

  const pages = Array.from({ length: totalPages }, (_, i) => i + 1).filter(
    (p) => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1
  )

  return (
    <nav className="mt-8 flex flex-wrap items-center justify-center gap-1.5" aria-label="Pagination">
      <Link
        href={buildHref(Math.max(1, currentPage - 1))}
        aria-disabled={currentPage === 1}
        tabIndex={currentPage === 1 ? -1 : undefined}
        className={`rounded-full border border-border px-3 py-1.5 text-sm font-medium transition-colors ${
          currentPage === 1
            ? 'pointer-events-none text-muted-foreground/50'
            : 'text-foreground hover:border-brand-orange hover:text-brand-orange'
        }`}
      >
        Prev
      </Link>

      {pages.map((p, i) => (
        <span key={p} className="flex items-center gap-1.5">
          {i > 0 && pages[i - 1] !== p - 1 && <span className="px-1 text-sm text-muted-foreground">…</span>}
          <Link
            href={buildHref(p)}
            aria-current={p === currentPage ? 'page' : undefined}
            className={`rounded-full px-3 py-1.5 text-sm font-medium tabular-nums transition-colors ${
              p === currentPage
                ? 'bg-brand-orange text-white'
                : 'border border-border text-foreground hover:border-brand-orange hover:text-brand-orange'
            }`}
          >
            {p}
          </Link>
        </span>
      ))}

      <Link
        href={buildHref(Math.min(totalPages, currentPage + 1))}
        aria-disabled={currentPage === totalPages}
        tabIndex={currentPage === totalPages ? -1 : undefined}
        className={`rounded-full border border-border px-3 py-1.5 text-sm font-medium transition-colors ${
          currentPage === totalPages
            ? 'pointer-events-none text-muted-foreground/50'
            : 'text-foreground hover:border-brand-orange hover:text-brand-orange'
        }`}
      >
        Next
      </Link>
    </nav>
  )
}
