'use client'

import { useMemo } from 'react'
import { ArrowDown, ArrowUp, RotateCcw, Star } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useRole } from '@/lib/auth/useRole'
import { useNavPrefs, MAX_PINNED_ITEMS } from '@/lib/useNavPrefs'
import { menuGroups } from '@/components/sidebar'
import { Checkbox } from '@/components/ui/checkbox'

// Self-service sidebar customization -- personal display preference only, layered
// on top of (never a substitute for) the role-based access already enforced by
// sidebar.tsx's canSee() and every underlying API route. Mirrors the grouped-
// checkbox pattern UserManager.tsx already uses for owner-curated page grants,
// applied here to what a user hides/pins/reorders on their own view.
export default function NavigationManager() {
  const { isOwner, allowedPages } = useRole()
  const { hiddenItems, pinnedItems, groupOrder, toggleHidden, togglePinned, setGroupOrder, reset } = useNavPrefs()

  const canSee = (item: { ownerOnly?: boolean; pageKey?: string }) =>
    (isOwner || !item.ownerOnly) && (isOwner || !item.pageKey || allowedPages.includes(item.pageKey))

  const visibleGroups = useMemo(() => {
    const filtered = menuGroups
      .filter(canSee)
      .map(group => 'children' in group && group.children
        ? { ...group, children: group.children.filter((c: any) => canSee(c)) }
        : group
      )
      .filter(group => !('children' in group && group.children) || group.children.length > 0)

    if (!groupOrder.length) return filtered
    const order = new Map(groupOrder.map((key, i) => [key, i]))
    return [...filtered].sort((a, b) => (order.get(a.key) ?? 999) - (order.get(b.key) ?? 999))
  }, [isOwner, allowedPages, groupOrder])

  const moveGroup = (index: number, dir: -1 | 1) => {
    const target = index + dir
    if (target < 0 || target >= visibleGroups.length) return
    const next = [...visibleGroups]
    ;[next[index], next[target]] = [next[target], next[index]]
    setGroupOrder(next.map(g => g.key))
  }

  const pinnedFull = pinnedItems.length >= MAX_PINNED_ITEMS

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted-foreground max-w-xl">
          Hide items you don't use, pin up to {MAX_PINNED_ITEMS} as Favorites at the top of your sidebar, and reorder
          groups. This only changes your own view — it never affects what you're allowed to open, and hidden items
          stay reachable via ⌘K search.
        </p>
        <button
          type="button"
          onClick={reset}
          className="flex-shrink-0 flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Reset to default
        </button>
      </div>

      <div className="space-y-3">
        {visibleGroups.map((group, index) => (
          <div key={group.key} className="rounded-xl border border-border overflow-hidden">
            <div className="flex items-center justify-between gap-2 bg-muted px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground">{group.label}</span>
                {!group.children && (
                  <Checkbox
                    checked={!hiddenItems.includes(group.key)}
                    onCheckedChange={() => toggleHidden(group.key)}
                    aria-label={`Show ${group.label} in sidebar`}
                  />
                )}
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => togglePinned(group.key)}
                  disabled={!pinnedItems.includes(group.key) && pinnedFull}
                  className="p-1 rounded hover:bg-secondary disabled:opacity-30"
                  aria-label={pinnedItems.includes(group.key) ? 'Unpin' : 'Pin to Favorites'}
                >
                  <Star className={cn('h-3.5 w-3.5', pinnedItems.includes(group.key) ? 'fill-current text-warning' : 'text-muted-foreground')} />
                </button>
                <button type="button" onClick={() => moveGroup(index, -1)} disabled={index === 0} className="p-1 rounded hover:bg-secondary disabled:opacity-30">
                  <ArrowUp className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
                <button type="button" onClick={() => moveGroup(index, 1)} disabled={index === visibleGroups.length - 1} className="p-1 rounded hover:bg-secondary disabled:opacity-30">
                  <ArrowDown className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              </div>
            </div>
            {group.children && (
              <div className="divide-y divide-border">
                {group.children.map((child: any) => (
                  <div key={child.key} className="flex items-center justify-between gap-2 px-3 py-2">
                    <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                      <Checkbox
                        checked={!hiddenItems.includes(child.key)}
                        onCheckedChange={() => toggleHidden(child.key)}
                      />
                      {child.label}
                    </label>
                    <button
                      type="button"
                      onClick={() => togglePinned(child.key)}
                      disabled={!pinnedItems.includes(child.key) && pinnedFull}
                      className="p-1 rounded hover:bg-secondary disabled:opacity-30"
                      aria-label={pinnedItems.includes(child.key) ? 'Unpin' : 'Pin to Favorites'}
                    >
                      <Star className={cn('h-3.5 w-3.5', pinnedItems.includes(child.key) ? 'fill-current text-warning' : 'text-muted-foreground')} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
