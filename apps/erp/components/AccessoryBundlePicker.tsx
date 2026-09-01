'use client'

import { useState, useEffect } from 'react'
import { apiFetch } from '@/lib/api-client'

export interface BundledAccessory {
  accessory_id: string
  accessory_name: string
  quantity: number
}

// Fungible/quantity-only categories -- a "complete set" purchase (e.g. a desktop with
// a keyboard and mouse) bumps real stock_movements against one of these existing
// sku_master rows, same mechanism as any other accessory receipt.
const ACCESSORY_CATEGORIES = 'RAM,SSD,CPU,GPU,KBD,MOUSE,ACC,ADP'

function mapSkuToAccessory(s: any): { id: string; accessory_name: string } {
  return { id: s.id, accessory_name: s.sku_description || s.model_name || s.full_sku_code }
}

// Search-and-add picker for fungible accessories bundled with a purchase/intake entry
// (e.g. a keyboard/mouse bought alongside a desktop). Shared by Stock Intake and the
// Purchases quick-entry dialog rather than forked per form -- both send the resulting
// list as `bundled_accessories: [{accessory_id, quantity}]`, and the server applies it
// as ordinary `stock_movements` receipts against those SKUs (see insertAccessoryMovement).
export function AccessoryBundlePicker({
  bundled,
  onChange,
  label = 'Bundled Accessories (e.g. keyboard, mouse, adapter, bag)',
}: {
  bundled: BundledAccessory[]
  onChange: (next: BundledAccessory[]) => void
  label?: string
}) {
  const [search, setSearch] = useState('')
  const [options, setOptions] = useState<{ id: string; accessory_name: string }[]>([])

  useEffect(() => {
    if (!search.trim()) { setOptions([]); return }
    const timer = setTimeout(async () => {
      const res = await apiFetch(`/api/sku-master?category=${ACCESSORY_CATEGORIES}&search=${encodeURIComponent(search)}`)
      const data = await res.json()
      setOptions(Array.isArray(data) ? data.map(mapSkuToAccessory) : [])
    }, 300)
    return () => clearTimeout(timer)
  }, [search])

  const add = (a: { id: string; accessory_name: string }) => {
    if (bundled.some((b) => b.accessory_id === a.id)) return
    onChange([...bundled, { accessory_id: a.id, accessory_name: a.accessory_name, quantity: 1 }])
    setSearch(''); setOptions([])
  }

  return (
    <div>
      <label className="block font-medium text-sm mb-1">{label}</label>
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search to add..."
        className="border p-2 w-full rounded"
      />
      {options.length > 0 && (
        <ul className="border rounded mt-1 max-h-40 overflow-y-auto">
          {options.map((a) => (
            <li key={a.id} onClick={() => add(a)} className="p-2 hover:bg-muted cursor-pointer border-b last:border-b-0">
              {a.accessory_name}
            </li>
          ))}
        </ul>
      )}
      {bundled.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {bundled.map((b, idx) => (
            <span key={b.accessory_id} className="bg-muted text-sm px-2 py-1 rounded flex items-center gap-1">
              {b.accessory_name}
              <input
                type="number"
                min={1}
                value={b.quantity}
                onChange={(e) => onChange(bundled.map((p, i) => (i === idx ? { ...p, quantity: Number(e.target.value) } : p)))}
                className="w-12 border rounded text-center"
              />
              <button onClick={() => onChange(bundled.filter((_, i) => i !== idx))} className="text-destructive">✕</button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
