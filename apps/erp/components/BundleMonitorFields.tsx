'use client'

export interface BundledMonitor {
  brand: string
  size: string
  resolution: string
  serial_number: string
}

export const EMPTY_BUNDLED_MONITOR: BundledMonitor = { brand: '', size: '', resolution: '', serial_number: '' }

// A desktop bought as part of a "complete set" often comes with its own monitor --
// unlike a keyboard/mouse (fungible, quantity-only), a monitor is a serialized item
// (its own sku_master/asset_ledger row, own serial number, independently QC'able and
// sellable later) so it needs real spec fields here, not just a quantity bump.
// Shared by Stock Intake and the Purchases quick-entry dialog.
export function BundleMonitorFields({ value, onChange }: { value: BundledMonitor; onChange: (v: BundledMonitor) => void }) {
  return (
    <div className="border rounded-lg p-4 space-y-3">
      <h4 className="font-medium text-sm">Monitor (bundled with this desktop)</h4>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs mb-1">Brand *</label>
          <input className="border p-2 w-full rounded" value={value.brand} onChange={(e) => onChange({ ...value, brand: e.target.value })} />
        </div>
        <div>
          <label className="block text-xs mb-1">Size (inches) *</label>
          <input type="number" step="0.1" className="border p-2 w-full rounded" value={value.size} onChange={(e) => onChange({ ...value, size: e.target.value })} />
        </div>
        <div>
          <label className="block text-xs mb-1">Resolution</label>
          <input className="border p-2 w-full rounded" placeholder="e.g. 1920x1080" value={value.resolution} onChange={(e) => onChange({ ...value, resolution: e.target.value })} />
        </div>
        <div>
          <label className="block text-xs mb-1">Serial Number</label>
          <input className="border p-2 w-full rounded" value={value.serial_number} onChange={(e) => onChange({ ...value, serial_number: e.target.value })} />
        </div>
      </div>
      <p className="text-xs text-gray-500">Creates its own trackable unit -- can be QC'd and sold independently of the desktop.</p>
    </div>
  )
}
