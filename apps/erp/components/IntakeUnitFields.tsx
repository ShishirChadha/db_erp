'use client'

import { Checkbox } from '@/components/ui/checkbox'
import { AccessoryBundlePicker, type BundledAccessory } from '@/components/AccessoryBundlePicker'
import { BundleMonitorFields, type BundledMonitor } from '@/components/BundleMonitorFields'

// The per-unit fields of a stock-in that aren't part of the SKU: when it was
// received, who bought it, what came with it, and condition notes. Shared by
// Stock Intake (app/dashboard/entry/intake) and Auto Check's review screen
// (app/dashboard/entry/auto-check) so the two stock-in doors can't drift apart.

export const BUYER_OPTIONS = ['Digitalbluez', 'Techtenth', 'Cash', 'Other']

export function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

export function ReceivedDateField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block font-medium text-sm mb-1">Date Received</label>
      <input type="date" value={value} max={todayIso()} onChange={(e) => onChange(e.target.value)} className="border p-2 w-full rounded" />
      <p className="text-xs text-muted-foreground mt-1">Backdate this if the unit was actually received earlier.</p>
    </div>
  )
}

export function PurchasedByField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block font-medium text-sm mb-1">Purchased By</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="border p-2 w-full rounded">
        {BUYER_OPTIONS.map((b) => <option key={b} value={b}>{b}</option>)}
      </select>
    </div>
  )
}

export function ConditionNotesField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block font-medium text-sm mb-1">Condition Notes</label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="e.g. Battery issue, keyboard pullout for spare parts, screen scratch..."
        className="border p-2 w-full rounded"
        rows={3}
      />
    </div>
  )
}

/** Accessories that came with the unit, plus a desktop's bundled monitor. */
export function UnitExtrasFields({
  category,
  bundled,
  onBundledChange,
  bundleMonitor,
  onBundleMonitorChange,
  bundledMonitor,
  onBundledMonitorChange,
}: {
  category: string
  bundled: BundledAccessory[]
  onBundledChange: (b: BundledAccessory[]) => void
  bundleMonitor: boolean
  onBundleMonitorChange: (v: boolean) => void
  bundledMonitor: BundledMonitor
  onBundledMonitorChange: (m: BundledMonitor) => void
}) {
  return (
    <>
      <AccessoryBundlePicker bundled={bundled} onChange={onBundledChange} />
      {category === 'DES' && (
        <div>
          <label className="flex items-center gap-2 text-sm font-medium">
            <Checkbox checked={bundleMonitor} onCheckedChange={(v) => onBundleMonitorChange(!!v)} />
            This came with a monitor (complete set)
          </label>
          {bundleMonitor && (
            <div className="mt-2">
              <BundleMonitorFields value={bundledMonitor} onChange={onBundledMonitorChange} />
            </div>
          )}
        </div>
      )}
    </>
  )
}
