'use client'

export interface StatCard {
  label: string
  value: string | number
  onClick?: () => void
  active?: boolean
}

// Small clickable summary cards shown at the top of a list page (Stock, Sales).
// A card without onClick is purely informational; a card with onClick narrows
// the list below using whatever filter state the page already has -- this
// component doesn't own any filtering logic itself.
export function StatCardsRow({ cards }: { cards: StatCard[] }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 mb-4">
      {cards.map((c) => (
        <button
          key={c.label}
          type="button"
          onClick={c.onClick}
          disabled={!c.onClick}
          className={`text-left border rounded-lg p-3 bg-card shadow-sm transition ${
            c.onClick ? 'hover:border-primary/40 cursor-pointer' : 'cursor-default'
          } ${c.active ? 'border-primary ring-1 ring-primary/20' : ''}`}
        >
          <div className="text-xs text-muted-foreground">{c.label}</div>
          <div className="text-xl font-semibold text-foreground">{c.value}</div>
        </button>
      ))}
    </div>
  )
}
