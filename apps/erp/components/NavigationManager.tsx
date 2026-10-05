'use client'

import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, GripVertical, RotateCcw, Star } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useRole } from '@/lib/auth/useRole'
import { useNavPrefs, MAX_PINNED_ITEMS } from '@/lib/useNavPrefs'
import { applyItemParentOverrides, NAV_TOP_LEVEL } from '@/lib/nav-tree'
import { menuGroups } from '@/components/sidebar'
import { Checkbox } from '@/components/ui/checkbox'

interface DragInfo {
  key: string
  label: string
  startX: number
  startY: number
  moved: boolean
}

// Minimum pointer travel before a press counts as a drag rather than a click
// -- without this, every ordinary click on a row (to check/uncheck it) would
// briefly flash the "moving" state.
const DRAG_THRESHOLD_PX = 6

// Self-service sidebar customization -- personal display preference only, layered
// on top of (never a substitute for) the role-based access already enforced by
// sidebar.tsx's canSee() and every underlying API route. Mirrors the grouped-
// checkbox pattern UserManager.tsx already uses for owner-curated page grants,
// applied here to what a user hides/pins/reorders/regroups on their own view.
export default function NavigationManager() {
  const { isOwner, allowedPages } = useRole()
  const { hiddenItems, pinnedItems, groupOrder, itemParents, toggleHidden, togglePinned, setGroupOrder, setItemParent, reset } = useNavPrefs()

  // Drag-and-drop reparenting -- lets any leaf item (a page with no sub-items
  // of its own, whether it currently stands alone at the top level like
  // "Attendance" or sits inside a group like "Purchase Orders") be dropped
  // onto a different top-level entry to move under it, or onto the "Top
  // level" strip to stand alone again.
  //
  // Built on the Pointer Events API (not native HTML5 draggable/dragstart) --
  // native drag-and-drop simply never fires on a touchscreen, and this page
  // is used from shop tablets/phones as much as desktops. Pointer events
  // cover mouse, touch and pen with the same code, same approach already used
  // for the resizable list panes elsewhere in this app.
  const [drag, setDrag] = useState<DragInfo | null>(null)
  const [pointerPos, setPointerPos] = useState<{ x: number; y: number } | null>(null)
  const [dragOverKey, setDragOverKey] = useState<string | null>(null)

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

    const reparented = applyItemParentOverrides(filtered, itemParents)

    if (!groupOrder.length) return reparented
    const order = new Map(groupOrder.map((key, i) => [key, i]))
    return [...reparented].sort((a, b) => (order.get(a.key) ?? 999) - (order.get(b.key) ?? 999))
  }, [isOwner, allowedPages, groupOrder, itemParents])

  const moveGroup = (index: number, dir: -1 | 1) => {
    const target = index + dir
    if (target < 0 || target >= visibleGroups.length) return
    const next = [...visibleGroups]
    ;[next[index], next[target]] = [next[target], next[index]]
    setGroupOrder(next.map(g => g.key))
  }

  const pinnedFull = pinnedItems.length >= MAX_PINNED_ITEMS

  const beginDrag = (key: string, label: string) => (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return // left mouse button only; touch/pen have no `button`
    setDrag({ key, label, startX: e.clientX, startY: e.clientY, moved: false })
  }

  useEffect(() => {
    if (!drag) return

    const handleMove = (e: PointerEvent) => {
      if (!drag.moved) {
        const dx = e.clientX - drag.startX
        const dy = e.clientY - drag.startY
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return
        setDrag(d => (d ? { ...d, moved: true } : d))
      }
      setPointerPos({ x: e.clientX, y: e.clientY })
      const el = document.elementFromPoint(e.clientX, e.clientY)
      const target = el?.closest<HTMLElement>('[data-nav-drop-target]')
      setDragOverKey(target?.dataset.navDropTarget ?? null)
    }

    const finish = (e: PointerEvent) => {
      if (drag.moved) {
        const el = document.elementFromPoint(e.clientX, e.clientY)
        const target = el?.closest<HTMLElement>('[data-nav-drop-target]')
        const targetKey = target?.dataset.navDropTarget
        if (targetKey && targetKey !== drag.key) setItemParent(drag.key, targetKey)
      }
      setDrag(null)
      setDragOverKey(null)
      setPointerPos(null)
    }

    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
    return () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
    }
  }, [drag, setItemParent])

  // Stops a tap on a checkbox/star/arrow from also being read as the start of
  // a drag on the row it sits inside.
  const stopRowDrag = (e: React.PointerEvent) => e.stopPropagation()

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted-foreground max-w-xl">
          Hide items you don't use, pin up to {MAX_PINNED_ITEMS} as Favorites at the top of your sidebar, reorder
          groups, and drag any item onto another to regroup it (e.g. drag Attendance onto Settings to move it
          there). This only changes your own view — it never affects what you're allowed to open, and hidden items
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

      {/* Drop zone for pulling a nested item back out to stand on its own --
          only shown while something is actually being dragged, so it doesn't
          clutter the page the rest of the time. */}
      {drag?.moved && (
        <div
          data-nav-drop-target={NAV_TOP_LEVEL}
          className={cn(
            'mb-3 rounded-xl border-2 border-dashed px-3 py-3 text-center text-xs font-medium transition-colors',
            dragOverKey === NAV_TOP_LEVEL
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-border text-muted-foreground'
          )}
        >
          Drop here to make it a main menu item on its own
        </div>
      )}

      <div className="space-y-3">
        {visibleGroups.map((group, index) => (
          <div
            key={group.key}
            data-nav-drop-target={group.key}
            className={cn(
              'rounded-xl border overflow-hidden transition-colors',
              drag?.moved && dragOverKey === group.key ? 'border-primary ring-2 ring-primary/30' : 'border-border'
            )}
          >
            <div
              onPointerDown={group.children ? undefined : beginDrag(group.key, group.label)}
              className={cn(
                'flex items-center justify-between gap-2 bg-muted px-3 py-2',
                !group.children && 'cursor-grab active:cursor-grabbing touch-none select-none'
              )}
            >
              <div className="flex items-center gap-2">
                {!group.children && <GripVertical className="h-3.5 w-3.5 text-muted-foreground/60 flex-shrink-0" />}
                <span className="text-sm font-medium text-foreground">{group.label}</span>
                {!group.children && (
                  <span onPointerDown={stopRowDrag}>
                    <Checkbox
                      checked={!hiddenItems.includes(group.key)}
                      onCheckedChange={() => toggleHidden(group.key)}
                      aria-label={`Show ${group.label} in sidebar`}
                    />
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1" onPointerDown={stopRowDrag}>
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
                  <div
                    key={child.key}
                    onPointerDown={beginDrag(child.key, child.label)}
                    className="flex items-center justify-between gap-2 px-3 py-2 cursor-grab active:cursor-grabbing touch-none select-none"
                  >
                    <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer" onPointerDown={stopRowDrag}>
                      <GripVertical className="h-3.5 w-3.5 text-muted-foreground/60 flex-shrink-0" />
                      <Checkbox
                        checked={!hiddenItems.includes(child.key)}
                        onCheckedChange={() => toggleHidden(child.key)}
                      />
                      {child.label}
                    </label>
                    <button
                      type="button"
                      onPointerDown={stopRowDrag}
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

      {/* Follows the cursor/finger while a drag is in progress -- there's no
          native drag "ghost" image since this isn't HTML5 drag-and-drop. */}
      {drag?.moved && pointerPos && (
        <div
          className="pointer-events-none fixed z-50 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-medium shadow-lg"
          style={{ left: pointerPos.x + 12, top: pointerPos.y + 12 }}
        >
          {drag.label}
        </div>
      )}
    </div>
  )
}
