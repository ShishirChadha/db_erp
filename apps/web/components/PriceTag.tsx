import { formatCurrency } from '@db/shared'

export function PriceTag({
  price,
  marketPrice,
  size = 'md',
}: {
  price: number
  marketPrice?: number | null
  size?: 'md' | 'lg'
}) {
  const hasDiscount = !!marketPrice && marketPrice > price
  const percentOff = hasDiscount ? Math.round(((marketPrice! - price) / marketPrice!) * 100) : 0

  return (
    <div className="flex flex-wrap items-center gap-2 tabular-nums">
      <span className={`font-heading font-bold text-foreground ${size === 'lg' ? 'text-3xl' : 'text-xl'}`}>
        {formatCurrency(price)}
      </span>
      {hasDiscount && (
        <>
          <span className="text-sm text-muted-foreground line-through">{formatCurrency(marketPrice)}</span>
          <span className="inline-flex items-center rounded-full bg-brand-orange/10 px-2 py-0.5 text-xs font-bold text-brand-orange-dark">
            {percentOff}% off
          </span>
        </>
      )}
    </div>
  )
}
