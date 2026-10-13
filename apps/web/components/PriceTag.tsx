import { formatCurrency } from '@db/shared'

// Shows the selling price only. A struck-through "MRP" and "% off" were removed
// (owner decision 2026-10-13): none of the stored market prices has a documented
// source, and an unsupported reference price is a misleading-pricing risk.
export function PriceTag({ price, size = 'md' }: { price: number; size?: 'md' | 'lg' }) {
  return (
    <div className="flex flex-wrap items-center gap-2 tabular-nums">
      <span className={`font-heading font-bold text-foreground ${size === 'lg' ? 'text-3xl' : 'text-xl'}`}>
        {formatCurrency(price)}
      </span>
    </div>
  )
}
