// Pure presentational grid for the entity (DB/TT/Cash) x category (Laptops/
// Desktops/Accessories/Repair/Rental) cross-tab, backed by
// report_category_entity_matrix. No hooks/client-only APIs -- importable from
// both a server component (Dashboard, which calls the RPC directly) and a
// client component (Reports, which calls it via /api/reports) without needing
// its own 'use client' directive.
export interface MatrixRow {
  entity: string
  category: string
  value: number
  count: number
}

const ENTITY_LABEL: Record<string, string> = {
  Digitalbluez: 'DB',
  Techtenth: 'TT',
  Cash: 'Cash',
}

function fmt(n: number): string {
  return `₹${Math.round(n).toLocaleString('en-IN')}`
}

export function CategoryEntityMatrixTable({
  title,
  subtitle,
  rows,
  categoryOrder,
  entityOrder = ['Digitalbluez', 'Techtenth', 'Cash'],
}: {
  title: string
  subtitle?: string
  rows: MatrixRow[]
  categoryOrder: string[]
  entityOrder?: string[]
}) {
  // Any entity value present in the data but not in the fixed order (e.g. a
  // purchase_orders.purchased_by_type of 'Other') still gets its own column
  // rather than silently disappearing from the total.
  const extraEntities = [...new Set(rows.map((r) => r.entity))].filter((e) => !entityOrder.includes(e))
  const entities = [...entityOrder, ...extraEntities]

  const cell = (category: string, entity: string) => {
    const match = rows.filter((r) => r.category === category && r.entity === entity)
    return {
      value: match.reduce((s, r) => s + r.value, 0),
      count: match.reduce((s, r) => s + r.count, 0),
    }
  }

  const rowTotal = (category: string) =>
    entities.reduce(
      (acc, e) => {
        const c = cell(category, e)
        return { value: acc.value + c.value, count: acc.count + c.count }
      },
      { value: 0, count: 0 }
    )

  const colTotal = (entity: string) =>
    categoryOrder.reduce(
      (acc, cat) => {
        const c = cell(cat, entity)
        return { value: acc.value + c.value, count: acc.count + c.count }
      },
      { value: 0, count: 0 }
    )

  const grandTotal = categoryOrder.reduce(
    (acc, cat) => {
      const t = rowTotal(cat)
      return { value: acc.value + t.value, count: acc.count + t.count }
    },
    { value: 0, count: 0 }
  )

  if (rows.length === 0) {
    return (
      <div>
        <h3 className="text-sm font-medium text-foreground mb-1">{title}</h3>
        <p className="text-sm text-muted-foreground">No data for this period.</p>
      </div>
    )
  }

  return (
    <div>
      <h3 className="text-sm font-medium text-foreground">{title}</h3>
      {subtitle && <p className="text-xs text-muted-foreground mb-2">{subtitle}</p>}
      <div className="overflow-x-auto rounded-md border mt-2">
        <table className="w-full text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">Category</th>
              {entities.map((e) => (
                <th key={e} className="text-right px-3 py-2 font-medium text-muted-foreground">{ENTITY_LABEL[e] || e}</th>
              ))}
              <th className="text-right px-3 py-2 font-medium text-foreground">Total</th>
            </tr>
          </thead>
          <tbody>
            {categoryOrder.map((cat) => {
              const total = rowTotal(cat)
              return (
                <tr key={cat} className="border-t">
                  <td className="px-3 py-2">{cat}</td>
                  {entities.map((e) => {
                    const c = cell(cat, e)
                    return (
                      <td key={e} className="px-3 py-2 text-right tabular-nums">
                        {c.value === 0 && c.count === 0 ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <>
                            {fmt(c.value)}
                            <span className="block text-xs text-muted-foreground">{c.count} units</span>
                          </>
                        )}
                      </td>
                    )
                  })}
                  <td className="px-3 py-2 text-right tabular-nums font-medium">
                    {fmt(total.value)}
                    <span className="block text-xs text-muted-foreground font-normal">{total.count} units</span>
                  </td>
                </tr>
              )
            })}
            <tr className="border-t bg-muted/50 font-medium">
              <td className="px-3 py-2">Total</td>
              {entities.map((e) => {
                const t = colTotal(e)
                return (
                  <td key={e} className="px-3 py-2 text-right tabular-nums">
                    {fmt(t.value)}
                    <span className="block text-xs text-muted-foreground font-normal">{t.count} units</span>
                  </td>
                )
              })}
              <td className="px-3 py-2 text-right tabular-nums">
                {fmt(grandTotal.value)}
                <span className="block text-xs text-muted-foreground font-normal">{grandTotal.count} units</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
