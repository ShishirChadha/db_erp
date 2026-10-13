import type { ReactNode } from 'react'

// Shared frame for the customer-facing policy pages (warranty, replacement,
// shipping) so they read and are marked up the same way.
export function PolicyLayout({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground">{title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">Last updated: {updated}</p>
      <div className="mt-6 space-y-6 text-sm leading-relaxed text-foreground">{children}</div>
    </main>
  )
}

export function PolicySection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 font-heading text-base font-bold">{title}</h2>
      {children}
    </section>
  )
}
