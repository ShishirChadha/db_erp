import Link from 'next/link'

// Replaces the old "we'll buy this back for ₹X" badge, which promised a fixed
// amount from placeholder numbers. A trade-in is quoted per unit, on WhatsApp.
export function TradeInBadge({ title, productUrl, whatsappNumber }: { title: string; productUrl: string; whatsappNumber: string }) {
  const message = `Hi, I'd like a trade-in quote for my old laptop/desktop. I'm interested in: ${title}\n${productUrl}`
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-brand-blue/20 bg-brand-blue/5 px-4 py-3">
      <div>
        <p className="text-sm font-semibold text-foreground">Trade in your old laptop</p>
        <p className="text-xs text-muted-foreground">Get a quote on WhatsApp — we price each unit after checking it.</p>
      </div>
      <a
        href={`https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}`}
        target="_blank"
        rel="noopener noreferrer"
        className="shrink-0 text-xs font-semibold text-brand-blue-dark hover:underline"
      >
        Get a quote →
      </a>
      <Link href="/buyback" className="sr-only">Trade-in details</Link>
    </div>
  )
}
