import Link from 'next/link'
import { buildConfigDiff, formatCurrency, type ConfigSummaryTemplate } from '@db/shared'
import type { PublicProduct } from '@/lib/queries'

// Our honest replacement for a Shopify-style variant selector: each chip is a
// real, independently-published sibling SKU (same brand+model, different
// spec), not an in-place variant swap of the current listing.
export function SiblingConfigs({
  current,
  siblings,
  templates,
}: {
  current: PublicProduct
  siblings: PublicProduct[]
  templates: ConfigSummaryTemplate[]
}) {
  if (siblings.length === 0) return null

  const currentDiff = buildConfigDiff(current.category, current.specifications, templates) || 'This configuration'

  return (
    <div>
      <p className="mb-2 text-sm font-semibold text-foreground">Other configurations of this model</p>
      <div className="flex flex-wrap gap-2">
        <span className="rounded-full border-2 border-brand-orange bg-brand-orange/10 px-3 py-1.5 text-xs font-semibold text-brand-orange-dark">
          {currentDiff} — {formatCurrency(current.web_price)}
        </span>
        {siblings.map((s) => (
          <Link
            key={s.id}
            href={`/product/${s.web_slug}`}
            className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-brand-orange/40 hover:text-brand-orange"
          >
            {buildConfigDiff(s.category, s.specifications, templates) || s.web_title} — {formatCurrency(s.web_price)}
          </Link>
        ))}
      </div>
    </div>
  )
}
