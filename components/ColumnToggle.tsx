'use client'

import { Settings2 } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'

// Generic column show/hide control -- persistence is the caller's responsibility
// (e.g. localStorage keyed per-page) so this stays a plain controlled component.
export function ColumnToggle<K extends string>({
  columns,
  visible,
  onChange,
}: {
  columns: readonly { key: K; label: string }[]
  visible: Record<K, boolean>
  onChange: (next: Record<K, boolean>) => void
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="inline-flex items-center gap-1.5">
          <Settings2 className="size-4" />
          Columns
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56">
        <p className="text-xs font-medium text-gray-500 px-1 pb-1">Show columns</p>
        {columns.map((col) => (
          <label key={col.key} className="flex items-center gap-2 px-1 py-1 text-sm cursor-pointer">
            <Checkbox
              checked={visible[col.key]}
              onCheckedChange={(v) => onChange({ ...visible, [col.key]: !!v })}
            />
            {col.label}
          </label>
        ))}
      </PopoverContent>
    </Popover>
  )
}
