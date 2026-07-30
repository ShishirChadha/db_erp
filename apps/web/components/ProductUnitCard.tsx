import { ConditionBadge } from './ConditionBadge'
import type { ProductUnit, TestReportItem } from '@/lib/queries'

// Only ever called with a single-unit array (page.tsx enforces the "exactly
// one sellable, graded unit" gate) -- ambiguous for a 2-unit SKU, so that
// case is filtered out before this component ever renders. The Testing
// checklist and condition breakdown are exactly as unit-specific as the
// serial number already shown, so they share the same gate.
export function ProductUnitCard({ unit, testReport }: { unit: ProductUnit; testReport: TestReportItem[] }) {
  if (!unit.serial_number) return null

  const conditionRows = [
    { label: 'Screen', value: unit.screen_condition },
    { label: 'Keyboard', value: unit.keyboard_condition },
    { label: 'Body', value: unit.body_condition },
  ].filter((r) => r.value)

  const passedChecks = testReport.filter((c) => c.result === 'pass')
  const failedChecks = testReport.filter((c) => c.result === 'fail')

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

      {(unit.battery_health_percent != null || unit.estimated_backup_hours != null) && (
        <div className="mt-3 flex flex-wrap gap-4 text-sm">
          {unit.battery_health_percent != null && (
            <span>
              Battery health: <span className="font-semibold text-foreground">{unit.battery_health_percent}%</span>
            </span>
          )}
          {unit.estimated_backup_hours != null && (
            <span>
              Est. backup: <span className="font-semibold text-foreground">{unit.estimated_backup_hours}h</span>
            </span>
          )}
        </div>
      )}

      {conditionRows.length > 0 && (
        <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
          {conditionRows.map((r) => (
            <div key={r.label} className="rounded-lg border border-border bg-card px-2 py-1.5 text-center">
              <div className="text-muted-foreground">{r.label}</div>
              <div className="font-semibold text-foreground">{r.value}</div>
            </div>
          ))}
        </div>
      )}

      {testReport.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-semibold text-foreground">Tested before listing</p>
          <div className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            {passedChecks.map((c) => (
              <div key={c.check_item} className="flex items-center gap-1.5 text-muted-foreground">
                <span className="text-brand-blue">✓</span> {c.check_item}
              </div>
            ))}
            {failedChecks.map((c) => (
              <div key={c.check_item} className="flex items-center gap-1.5 text-muted-foreground">
                <span className="text-destructive">✗</span> {c.check_item}
              </div>
            ))}
          </div>
        </div>
      )}

      {unit.warranty_duration_months != null && (
        <p className="mt-3 text-xs text-muted-foreground">
          Warranty: <span className="font-medium text-foreground">{unit.warranty_duration_months} months</span>
          {unit.warranty_type && unit.warranty_type !== 'none' ? ` (${unit.warranty_type.replace('_', ' ')})` : ''}
        </p>
      )}

      {unit.included_accessories && (
        <p className="mt-1 text-xs text-muted-foreground">
          Includes: <span className="font-medium text-foreground">{unit.included_accessories}</span>
        </p>
      )}
    </div>
  )
}
