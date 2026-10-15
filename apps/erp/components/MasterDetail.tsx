'use client'

import type { ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import { cn } from '@/lib/utils'

// Vertical list + detail pane, the same pattern as ActivityList / StockView:
// below the breakpoint ONE pane shows at a time (the list, or the detail with a
// "Back" button); at or above it both show side by side. It exists so settings
// screens never need horizontal tabs or wide tables that scroll sideways.
//
// bp="md"  -> two panes from 768px  (a section menu with short labels)
// bp="xl"  -> two panes from 1280px (a list of records plus a wide editing form,
//             which needs the room; narrower screens use the one-pane flow)
// Class names are written out in full (not built from bp) so Tailwind sees them.

const BP = {
  md: {
    wrap: 'md:flex md:items-start md:gap-4',
    list: 'md:w-60 md:shrink-0 md:border-r md:border-border md:pr-3',
    hide: 'hidden md:block',
    back: 'md:hidden',
  },
  xl: {
    wrap: 'xl:flex xl:items-start xl:gap-4',
    list: 'xl:w-64 xl:shrink-0 xl:border-r xl:border-border xl:pr-3',
    hide: 'hidden xl:block',
    back: 'xl:hidden',
  },
} as const

export function Panes({
  list,
  children,
  open,
  onBack,
  backLabel = 'Back to list',
  bp = 'md',
}: {
  list: ReactNode
  children: ReactNode
  /** One-pane screens: true = show the detail, false = show the list. */
  open: boolean
  onBack: () => void
  backLabel?: string
  bp?: 'md' | 'xl'
}) {
  const c = BP[bp]
  return (
    <div className={c.wrap}>
      <div className={cn('w-full', c.list, open && c.hide)}>{list}</div>
      <div className={cn('min-w-0 flex-1', !open && c.hide)}>
        <button
          type="button"
          onClick={onBack}
          className={cn('mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground', c.back)}
        >
          <ArrowLeft className="size-4" /> {backLabel}
        </button>
        {children}
      </div>
    </div>
  )
}

export function ListItem({
  selected,
  onClick,
  title,
  sub,
  right,
}: {
  selected?: boolean
  onClick: () => void
  title: ReactNode
  sub?: ReactNode
  right?: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full rounded-lg px-3 py-2 text-left text-sm transition-colors',
        selected ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
      )}
    >
      <span className="flex items-start justify-between gap-2">
        <span className="min-w-0 break-words font-medium">{title}</span>
        {right}
      </span>
      {sub && (
        <span className={cn('block break-all text-xs', selected ? 'text-primary-foreground/80' : 'text-muted-foreground')}>
          {sub}
        </span>
      )}
    </button>
  )
}

const TONES = {
  green: 'bg-green-100 text-green-800',
  amber: 'bg-amber-100 text-amber-800',
  red: 'bg-red-100 text-red-800',
  gray: 'bg-muted text-muted-foreground',
} as const

export function Pill({ tone = 'gray', children }: { tone?: keyof typeof TONES; children: ReactNode }) {
  return <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium', TONES[tone])}>{children}</span>
}

export function ListHeader({ title, onNew, newLabel = '+ New' }: { title: string; onNew?: () => void; newLabel?: string }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</span>
      {onNew && (
        <button type="button" onClick={onNew} className="rounded border px-2 py-1 text-xs font-medium hover:bg-muted">
          {newLabel}
        </button>
      )}
    </div>
  )
}

/** Section menu: one entry per screen, with an optional one-line hint. */
export interface NavEntry {
  key: string
  label: string
  hint?: string
  badge?: ReactNode
}

export function NavList({ entries, active, onSelect }: { entries: NavEntry[]; active: string; onSelect: (key: string) => void }) {
  return (
    <nav className="space-y-1">
      {entries.map((e) => (
        <ListItem key={e.key} selected={active === e.key} onClick={() => onSelect(e.key)} title={e.label} sub={e.hint} right={e.badge} />
      ))}
    </nav>
  )
}
