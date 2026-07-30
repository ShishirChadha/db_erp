import Link from 'next/link'
import { formatCurrency } from '@db/shared'
import { BUYBACK_PERCENT, BUYBACK_WINDOW_MONTHS } from '@/lib/business-info'

export function BuybackBadge({ price }: { price: number }) {
  const assuredAmount = Math.round((price * BUYBACK_PERCENT) / 100)

  return (
    <Link
      href="/buyback"
      className="flex items-center justify-between gap-3 rounded-xl border border-brand-blue/20 bg-brand-blue/5 px-4 py-3 transition-colors hover:border-brand-blue/40"
    >
      <div>
        <p className="text-sm font-semibold text-foreground">Buyback guarantee</p>
        <p className="text-xs text-muted-foreground">
          We'll buy this back for {formatCurrency(assuredAmount)} within {BUYBACK_WINDOW_MONTHS} months
        </p>
      </div>
      <span className="shrink-0 text-xs font-semibold text-brand-blue-dark">Details →</span>
    </Link>
  )
}
