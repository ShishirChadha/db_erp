import { ConditionBadge } from './ConditionBadge'
import type { ProductUnit } from '@/lib/queries'

// Only ever called with a single-unit array (page.tsx enforces the "exactly
// one sellable, graded unit" gate) -- ambiguous for a 2-unit SKU, so that
// case is filtered out before this component ever renders.
export function ProductUnitCard({ unit }: { unit: ProductUnit }) {
  if (!unit.serial_number) return null

  return (
    <div className="rounded-xl border border-border bg-secondary/30 p-4">
      <p className="text-sm font-semibold text-foreground">This exact unit</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">
          Serial: <span className="font-medium text-foreground">{unit.serial_number}</span>
        </span>
        {unit.qc_grade && <ConditionBadge grade={unit.qc_grade} />}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Quality-checked before listing — you're buying this specific unit, not a random pick.
      </p>
    </div>
  )
}
