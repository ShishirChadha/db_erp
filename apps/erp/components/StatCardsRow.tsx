'use client'

export interface StatCard {
  label: string
  value: string | number
  onClick?: () => void
  active?: boolean
}

// Small clickable summary strip shown at the top of a list page (Stock, Sales,
// Repair Jobs, Rentals, SKU Master) -- a single-row, Zoho-style inline strip of
// "label: value" pairs (divided by a hairline between each) instead of a grid of
// bordered/shadowed cards, so it never wraps to a second row even with 6-7 cards
// (Stock's owner view, SKU Master). Falls back to horizontal scroll rather than
// wrapping when it doesn't fit at narrow widths. A card without onClick is purely
// informational; a card with onClick narrows the list below using whatever filter
// state the page already has -- this component doesn't own any filtering logic
// itself, and every consumer's existing cards={[{label, value, onClick?, active?}]}
// shape is unchanged.
export function StatCardsRow({ cards }: { cards: StatCard[] }) {
  return (
    <div className="flex items-stretch gap-0.5 mb-2 overflow-x-auto">
      {cards.map((c, i) => (
        <button
          key={c.label}
          type="button"
          onClick={c.onClick}
          disabled={!c.onClick}
          className={`flex items-baseline gap-1.5 px-2.5 py-1.5 whitespace-nowrap shrink-0 transition-colors rounded-md ${
            i > 0 ? 'border-l border-border' : ''
          } ${c.onClick ? 'hover:bg-muted cursor-pointer' : 'cursor-default'} ${
            c.active ? 'bg-primary/10' : ''
          }`}
        >
          <span className={`text-xs ${c.active ? 'text-primary' : 'text-muted-foreground'}`}>{c.label}</span>
          <span className={`text-sm font-semibold tabular-nums ${c.active ? 'text-primary' : 'text-foreground'}`}>{c.value}</span>
        </button>
      ))}
    </div>
  )
}
