// Reparents sidebar items per a user's own drag-and-drop preference (e.g.
// moving "Attendance" to live under "Settings" instead of standing alone at
// the top level) -- a personal display-layer transform applied on top of the
// hardcoded `menuGroups` tree in components/sidebar.tsx, the same way
// hidden/pinned/groupOrder already are. Shared by sidebar.tsx (the real nav)
// and NavigationManager.tsx (the Settings -> My Navigation editor) so both
// always agree on the resulting shape.
//
// Only ever 2 levels deep, matching what the sidebar can actually render (a
// top-level entry is either a plain link or an expandable group of leaf
// links -- there's no 3rd level). So only a *leaf* (an item with no children
// of its own) can be moved, and it can only be dropped onto one of the
// ORIGINAL top-level entries -- never onto something that was itself just
// reparented this pass. Both rules are enforced below, and an invalid or
// stale override (a renamed/removed key) is silently ignored rather than
// thrown on, same "unknown degrades quietly" rule this app already follows
// for nav items.
export const NAV_TOP_LEVEL = '__top__'

interface NavNode {
  key: string
  href?: string
  children?: NavNode[]
  [extra: string]: unknown
}

export function applyItemParentOverrides<T extends NavNode>(groups: T[], itemParents: Record<string, string> | undefined): T[] {
  if (!itemParents || Object.keys(itemParents).length === 0) return groups

  const originalTopLevelKeys = new Set(groups.map((g) => g.key))

  // Clone one level deep (new top-level array + new children arrays) so the
  // splice/push below never mutates the shared `menuGroups` source.
  const topLevel: T[] = groups.map((g) => (g.children ? ({ ...g, children: [...g.children] } as T) : ({ ...g } as T)))

  const allNodes = new Map<string, T>()
  for (const g of topLevel) {
    allNodes.set(g.key, g)
    if (g.children) for (const c of g.children) allNodes.set(c.key, c as T)
  }

  for (const [itemKey, parentKey] of Object.entries(itemParents)) {
    if (itemKey === parentKey) continue
    const node = allNodes.get(itemKey)
    if (!node || node.children) continue // unknown key, or a real multi-item group -- never moved as a unit
    if (parentKey !== NAV_TOP_LEVEL && !originalTopLevelKeys.has(parentKey)) continue

    // Detach from wherever it currently lives.
    for (const g of topLevel) {
      if (g.children) {
        const idx = g.children.indexOf(node)
        if (idx !== -1) g.children.splice(idx, 1)
      }
    }
    const topIdx = topLevel.indexOf(node)
    if (topIdx !== -1) topLevel.splice(topIdx, 1)

    if (parentKey === NAV_TOP_LEVEL) {
      topLevel.push(node)
      continue
    }
    const parent = topLevel.find((g) => g.key === parentKey)
    if (!parent) continue
    if (!parent.children) parent.children = []
    parent.children.push(node)
  }

  // A top-level entry left with zero children either reverts to being a
  // plain link (it had its own href before gaining children, e.g. "Settings")
  // or, if it never had one (a pure container like "Purchasing"), disappears
  // rather than rendering as a dead-end expandable header with nothing in it
  // -- the exact rule sidebar.tsx/NavigationManager.tsx already apply when
  // role-filtering empties a group.
  return topLevel
    .map((g) => {
      if (Array.isArray(g.children) && g.children.length === 0) {
        const { children, ...leaf } = g
        return leaf as T
      }
      return g
    })
    .filter((g) => !!g.children || !!g.href)
}
