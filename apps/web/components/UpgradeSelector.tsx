'use client'

import { useState } from 'react'
import { formatCurrency } from '@db/shared'
import type { UpgradeOption } from '@/lib/queries'
import type { SelectedUpgrade } from '@/lib/upgrades'

const FIELD_LABELS: Record<string, string> = {
  ram: 'RAM',
  ssd: 'SSD',
  warranty_months: 'Warranty',
}

function optionKey(o: UpgradeOption) {
  return `${o.category}:${o.field_name}:${o.from_value}:${o.to_value}`
}

// A RAM/SSD upgrade is a real paid physical-modification service performed
// by staff before shipping (see the Upgrade Options architecture note) --
// not an instant swap. Warranty just extends the on-file warranty, no
// physical action needed. At most one choice per field; "Keep current" is
// always an option.
export function UpgradeSelector({
  options,
  onChange,
}: {
  options: UpgradeOption[]
  onChange: (selected: SelectedUpgrade[]) => void
}) {
  const byField = options.reduce<Record<string, UpgradeOption[]>>((acc, o) => {
    ;(acc[o.field_name] ||= []).push(o)
    return acc
  }, {})

  const [picked, setPicked] = useState<Record<string, UpgradeOption | null>>({})

  if (options.length === 0) return null

  const pick = (field: string, option: UpgradeOption | null) => {
    const next = { ...picked, [field]: option }
    setPicked(next)
    onChange(
      Object.values(next)
        .filter((o): o is UpgradeOption => !!o)
        .map((o) => ({
          rule_id: optionKey(o),
          field_name: o.field_name,
          from_value: o.from_value,
          to_value: o.to_value,
          price_delta: o.price_delta,
        }))
    )
  }

  return (
    <div className="mt-5 space-y-4">
      {Object.entries(byField).map(([field, opts]) => (
        <div key={field}>
          <p className="mb-1.5 text-sm font-semibold text-foreground">Upgrade {FIELD_LABELS[field] || field}?</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => pick(field, null)}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                !picked[field] ? 'border-brand-orange bg-brand-orange/10 text-brand-orange' : 'border-border text-muted-foreground hover:border-brand-orange/40'
              }`}
            >
              Keep current
            </button>
            {opts.map((o) => (
              <button
                key={optionKey(o)}
                type="button"
                onClick={() => pick(field, o)}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                  picked[field] && optionKey(picked[field]!) === optionKey(o)
                    ? 'border-brand-orange bg-brand-orange/10 text-brand-orange'
                    : 'border-border text-muted-foreground hover:border-brand-orange/40'
                }`}
              >
                {o.to_value} (+{formatCurrency(o.price_delta)})
              </button>
            ))}
          </div>
          {field !== 'warranty_months' && picked[field] && (
            <p className="mt-1 text-xs text-muted-foreground">
              This is a physical upgrade performed by us before shipping — it'll add a little to dispatch time.
            </p>
          )}
        </div>
      ))}
    </div>
  )
}
