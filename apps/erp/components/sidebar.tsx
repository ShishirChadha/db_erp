'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  LayoutDashboard,
  ShoppingCart,
  TrendingUp,
  Receipt,
  Users,
  LogOut,
  Laptop,
  Menu,
  X,
  Barcode,
  Settings,
  CalendarDays,
  ChevronDown,
  PackagePlus,
  Wrench,
  Loader2,
  ListChecks,
  Search,
  Star,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useRole } from '@/lib/auth/useRole'
import { useAsyncAction } from '@/lib/useAsyncAction'
import { apiFetch } from '@/lib/api-client'
import NotificationBell from '@/components/NotificationBell'
import { useNavPalette } from '@/components/AdvisorLauncher'
import { useNavPrefs } from '@/lib/useNavPrefs'

// ---------- Menu structure with categories ----------
// ownerOnly: hidden from the sidebar entirely for the 'employee' role. This is nav
// convenience only -- every underlying API route enforces the same restriction itself.
//
// Regrouped 2026-09 to cut top-level entries from 15 to 11 (see docs/decisions.md):
// Accessories folded into Inventory, "Service" merged into "Live Stock" (renamed
// Operations), Audit Log + Backup relocated into Settings tabs (settings/page.tsx's
// CATEGORIES, not this file) since Settings is no longer owner-exclusive. No page
// was moved or removed -- purely a nav-grouping change. Every leaf item's `key` is
// stable and independent of its label/grouping -- it's what My Navigation prefs
// (hidden/pinned/order) key off, so relabeling a group here never orphans a
// user's saved preference.
export const menuGroups = [
  {
    key: 'dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
    href: '/dashboard',
    pageKey: 'dashboard',
  },
  {
    key: 'pending_tasks',
    label: 'Pending Tasks',
    icon: ListChecks,
    href: '/dashboard/pending-tasks',
    pageKey: 'pending_tasks',
  },
  {
    key: 'new_entry',
    label: 'New Entry',
    icon: PackagePlus,
    href: '/dashboard/entry',
    pageKey: 'new_entry',
  },
  {
    key: 'purchasing',
    label: 'Purchasing',
    icon: ShoppingCart,
    ownerOnly: true,
    children: [
      { key: 'purchase_orders', href: '/dashboard/purchase-orders', label: 'Purchase Orders' },
      { key: 'purchase_invoices', href: '/dashboard/purchase-invoices', label: 'Purchase Invoices' },
      { key: 'purchases_old', href: '/dashboard/purchases', label: 'OLD Purchase IN' },
    ],
  },
  {
    key: 'inventory',
    label: 'Inventory',
    icon: Barcode,
    children: [
      { key: 'sku_master', href: '/dashboard/sku-master', label: 'SKU Master', pageKey: 'sku_master' },
      { key: 'stock', href: '/dashboard/stock', label: 'Stock / Assets (Main ERP)', pageKey: 'stock' },
      { key: 'accessories', href: '/dashboard/accessories', label: 'Accessories', pageKey: 'accessories' },
    ],
  },
  {
    key: 'operations',
    label: 'Operations',
    icon: Laptop,
    children: [
      { key: 'live_stock', href: '/dashboard/live-stock', label: 'Live Stock', pageKey: 'live_stock' },
      { key: 'repair_jobs', href: '/dashboard/repair-jobs', label: 'Repair Jobs', pageKey: 'repair_jobs' },
      { key: 'replacement_jobs', href: '/dashboard/replacement-jobs', label: 'Replacement Jobs', pageKey: 'replacement_jobs' },
      { key: 'rma', href: '/dashboard/rma', label: 'RMA (Vendor Returns)', pageKey: 'rma' },
    ],
  },
  {
    key: 'sales',
    label: 'Sales',
    icon: TrendingUp,
    children: [
      { key: 'sales', href: '/dashboard/sales', label: 'Sales', pageKey: 'sales' },
      { key: 'invoices', href: '/dashboard/invoices', label: 'Invoices', pageKey: 'invoices' },
      { key: 'quotations', href: '/dashboard/quotations', label: 'Quotations', pageKey: 'quotations' },
      // Price Cockpit stays owner-only -- its core data (price-intel) mixes vendor
      // names/buying cost with competitor prices in one response with no safe
      // employee-facing subset, unlike every other page-keyed area.
      { key: 'pricing', href: '/dashboard/pricing', label: 'Price Cockpit', ownerOnly: true },
    ],
  },
  {
    key: 'contacts',
    label: 'Contacts',
    icon: Users,
    children: [
      { key: 'customers', href: '/dashboard/customers', label: 'Customers', pageKey: 'customers' },
      { key: 'vendors', href: '/dashboard/vendors', label: 'Vendors', ownerOnly: true },
    ],
  },
  {
    key: 'finance',
    label: 'Finance',
    icon: Receipt,
    // No group-level ownerOnly -- each child now has its own pageKey, and the
    // "drop empty groups" step in canSee() already hides this group entirely for
    // a role with neither grant (same pattern as Inventory/Operations/Sales).
    children: [
      { key: 'expenses', href: '/dashboard/expenses', label: 'Expenses', pageKey: 'expenses' },
      { key: 'reports', href: '/dashboard/reports', label: 'Reports', pageKey: 'reports' },
      // Reconciliation pages are always cost/vendor-bearing (an uploaded vendor
      // invoice, bank transaction contents) -- ownerOnly rather than a pageKey
      // grant, same posture as Vendors/RMA/Quotations, not the broader
      // manager/employee-grantable pattern the rest of Finance now uses.
      { key: 'recon_vendors', href: '/dashboard/recon/vendors', label: 'Vendor Reconciliation', ownerOnly: true },
      { key: 'recon_bank', href: '/dashboard/recon/bank', label: 'Bank Reconciliation', ownerOnly: true },
      { key: 'recon_sessions', href: '/dashboard/recon/sessions', label: 'Recon Sessions', ownerOnly: true },
    ],
  },
  {
    key: 'activities',
    label: 'Activity Hub',
    icon: CalendarDays,
    href: '/dashboard/activities',
    pageKey: 'activities',
  },
  {
    key: 'settings',
    label: 'Settings',
    icon: Settings,
    href: '/dashboard/settings',
    // No longer ownerOnly -- Settings now also hosts self-service tabs
    // (Appearance, My Navigation, Audit Log) visible to every active user;
    // the 9 admin tabs inside it (incl. the relocated Audit Log/Backup) stay
    // owner-gated at the tab level, not the page level. See settings/page.tsx.
  },
]

// ---------- Sidebar Content (with collapsible groups) ----------
function SidebarContent({
  pathname,
  onLogout,
  loggingOut,
  onMobileClose,
  isOwner,
  allowedPages,
}: {
  pathname: string
  onLogout: () => void
  loggingOut: boolean
  onMobileClose: () => void
  isOwner: boolean
  allowedPages: string[]
}) {
  const canSee = (item: { ownerOnly?: boolean; pageKey?: string }) =>
    (isOwner || !item.ownerOnly) && (isOwner || !item.pageKey || allowedPages.includes(item.pageKey))

  // Some child links carry a query string (e.g. Replacement/Return deep-linking into
  // the Service form) -- usePathname() never includes it, so active-state matching
  // compares against just the path portion of a child's href.
  const childPath = (href: string) => href.split('?')[0]

  const { hiddenItems, pinnedItems, groupOrder, togglePinned } = useNavPrefs()
  const { open: openSearch } = useNavPalette()

  const roleFilteredGroups = useMemo(
    () => menuGroups
      .filter(canSee)
      .map(group => 'children' in group && group.children
        ? { ...group, children: group.children.filter((c: any) => canSee(c)) }
        : group
      )
      // A group whose children are all filtered out for this role would otherwise
      // render as a dead-end expandable header with nothing inside it.
      .filter(group => !('children' in group && group.children) || group.children.length > 0),
    [isOwner, allowedPages]
  )

  // Personal display preferences layer on top of the role filter above -- never a
  // substitute for it. Hiding/reordering only ever touches what this user could
  // already see; a hidden item stays reachable via ⌘K search and "Reset to default"
  // in Settings → My Navigation.
  const visibleGroups = useMemo(() => {
    const withHidden = roleFilteredGroups
      .filter(g => !hiddenItems.includes(g.key))
      .map(g => 'children' in g && g.children
        ? { ...g, children: g.children.filter((c: any) => !hiddenItems.includes(c.key)) }
        : g
      )
      .filter(g => !('children' in g && g.children) || g.children.length > 0)

    if (!groupOrder.length) return withHidden
    const order = new Map(groupOrder.map((key, i) => [key, i]))
    return [...withHidden].sort((a, b) => (order.get(a.key) ?? 999) - (order.get(b.key) ?? 999))
  }, [roleFilteredGroups, hiddenItems, groupOrder])

  // Flat "Favorites" list of pinned leaf items, shown above every group.
  const favoriteItems = useMemo(() => {
    if (!pinnedItems.length) return []
    const flat: { key: string; href: string; label: string }[] = []
    for (const group of roleFilteredGroups) {
      if ('href' in group && group.href) flat.push({ key: group.key, href: group.href, label: group.label })
      if ('children' in group && group.children) {
        for (const child of group.children) flat.push({ key: child.key, href: child.href, label: child.label })
      }
    }
    return pinnedItems.map(key => flat.find(f => f.key === key)).filter((f): f is typeof flat[number] => !!f)
  }, [roleFilteredGroups, pinnedItems])

  // State for each group (key = item key) whether it's open
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    // Initialize: open the group if it contains the current path
    const initial: Record<string, boolean> = {}
    menuGroups.forEach(group => {
      if (group.children) {
        initial[group.key] = group.children.some(child => pathname.startsWith(childPath(child.href)))
      }
    })
    return initial
  })

  // Update open state when pathname changes
  useEffect(() => {
    setOpenGroups(prev => {
      const next = { ...prev }
      menuGroups.forEach(group => {
        if (group.children) {
          const isActive = group.children.some(child => pathname.startsWith(childPath(child.href)))
          if (isActive) next[group.key] = true
        }
      })
      return next
    })
  }, [pathname])

  const toggleGroup = (key: string) => {
    setOpenGroups(prev => ({ ...prev, [key]: !prev[key] }))
  }

  return (
    <div className="flex flex-col h-full bg-sidebar">
      {/* Logo */}
      <div className="flex items-center justify-between gap-3 px-4 py-5 border-b border-sidebar-border">
        <Link href="/dashboard" className="flex items-center gap-3">
          <div className="bg-primary p-2 rounded-xl">
            <Laptop className="h-5 w-5 text-primary-foreground" />
          </div>
          <div>
            <p className="font-semibold text-sidebar-foreground text-sm">DigitalBluez</p>
            <p className="text-xs text-muted-foreground">ERP System</p>
          </div>
        </Link>
        <NotificationBell />
      </div>

      {/* Search / jump-to-page */}
      <div className="px-3 pt-3">
        <button
          type="button"
          onClick={openSearch}
          className="flex w-full items-center gap-2 rounded-xl border border-sidebar-border bg-sidebar px-3 py-2 text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-all"
        >
          <Search className="h-4 w-4 flex-shrink-0" />
          <span className="flex-1 text-left">Search...</span>
          <kbd className="rounded bg-sidebar-accent px-1.5 py-0.5 text-xs">⌘K</kbd>
        </button>
      </div>

      {/* Nav items */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {favoriteItems.length > 0 && (
          <div className="pb-2 mb-2 border-b border-sidebar-border space-y-1">
            <p className="px-3 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Favorites</p>
            {favoriteItems.map(item => {
              const isActive = pathname === childPath(item.href)
              return (
                <Link
                  key={`fav-${item.key}`}
                  href={item.href}
                  onClick={onMobileClose}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2 rounded-xl text-sm transition-all',
                    isActive
                      ? 'bg-primary text-primary-foreground font-medium'
                      : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                  )}
                >
                  <Star className="h-3.5 w-3.5 flex-shrink-0 fill-current text-warning" />
                  {item.label}
                </Link>
              )
            })}
          </div>
        )}
        {visibleGroups.map(group => {
          // If it has children, render a collapsible group
          if (group.children) {
            const isOpen = openGroups[group.key] ?? false
            const isActive = group.children.some(child => pathname === child.href)

            return (
              <div key={group.key}>
                <button
                  onClick={() => toggleGroup(group.key)}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all w-full',
                    isActive
                      ? 'bg-primary text-primary-foreground'
                      : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                  )}
                >
                  {group.icon && <group.icon className="h-4 w-4 flex-shrink-0" />}
                  <span className="flex-1 text-left">{group.label}</span>
                  <ChevronDown
                    className={cn(
                      'h-4 w-4 flex-shrink-0 transition-transform',
                      isOpen && 'rotate-180'
                    )}
                  />
                </button>
                {isOpen && (
                  <div className="ml-6 mt-1 space-y-1">
                    {group.children.map(child => {
                      const childActive = pathname === child.href
                      return (
                        <div key={child.href} className="group/navitem flex items-center">
                          <Link
                            href={child.href}
                            onClick={onMobileClose}
                            className={cn(
                              'flex-1 flex items-center gap-3 px-3 py-2 rounded-xl text-sm transition-all',
                              childActive
                                ? 'bg-primary/10 text-primary font-medium'
                                : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                            )}
                          >
                            {child.label}
                          </Link>
                          <button
                            type="button"
                            onClick={() => togglePinned(child.key)}
                            className={cn(
                              'flex-shrink-0 p-1.5 rounded-lg opacity-0 group-hover/navitem:opacity-100 hover:bg-sidebar-accent transition-opacity',
                              pinnedItems.includes(child.key) && 'opacity-100'
                            )}
                            aria-label={pinnedItems.includes(child.key) ? 'Unpin from favorites' : 'Pin to favorites'}
                          >
                            <Star className={cn('h-3.5 w-3.5', pinnedItems.includes(child.key) ? 'fill-current text-warning' : 'text-muted-foreground')} />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          }

          // Otherwise, a simple link
          const isActive = pathname === group.href
          return (
            <Link
              key={group.href || group.key}
              href={group.href!}
              onClick={onMobileClose}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all',
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
              )}
            >
              {group.icon && <group.icon className="h-4 w-4 flex-shrink-0" />}
              {group.label}
            </Link>
          )
        })}
      </nav>

      {/* Logout */}
      <div className="px-3 py-4 border-t border-sidebar-border">
        <button
          onClick={onLogout}
          disabled={loggingOut}
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-sidebar-foreground hover:bg-destructive/10 hover:text-destructive transition-all w-full disabled:opacity-50"
        >
          {loggingOut ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
          Sign out
        </button>
      </div>
    </div>
  )
}

// ---------- Main Sidebar Component (unchanged wrapper) ----------
export default function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()
  const { isOwner, allowedPages } = useRole()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [clientPathname, setClientPathname] = useState('')

  useEffect(() => {
    if (pathname) setClientPathname(pathname)
  }, [pathname])

  const { run: handleLogout, pending: loggingOut } = useAsyncAction(async () => {
    // Must fire before signOut() -- the token is still valid here, dead after.
    await apiFetch('/api/auth/log-event', { method: 'POST', body: JSON.stringify({ event: 'logout' }) }).catch(() => {})
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  })

  const closeMobile = useCallback(() => setMobileOpen(false), [])
  const toggleMobile = useCallback(() => setMobileOpen(prev => !prev), [])

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && mobileOpen) closeMobile()
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [mobileOpen, closeMobile])

  const sidebarContent = useMemo(
    () => (
      <SidebarContent
        pathname={clientPathname}
        onLogout={handleLogout}
        loggingOut={loggingOut}
        onMobileClose={closeMobile}
        isOwner={isOwner}
        allowedPages={allowedPages}
      />
    ),
    [clientPathname, handleLogout, loggingOut, closeMobile, isOwner, allowedPages]
  )

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-56 bg-sidebar border-r border-sidebar-border flex-col flex-shrink-0">
        {sidebarContent}
      </aside>

      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-40 bg-sidebar border-b border-sidebar-border px-4 py-3 flex items-center justify-between">
        <Link href="/dashboard" className="flex items-center gap-2" onClick={closeMobile}>
          <div className="bg-primary p-1.5 rounded-lg">
            <Laptop className="h-4 w-4 text-primary-foreground" />
          </div>
          <span className="font-semibold text-sidebar-foreground text-sm">DigitalBluez ERP</span>
        </Link>
        <button onClick={toggleMobile}>
          {mobileOpen ? (
            <X className="h-5 w-5 text-muted-foreground" />
          ) : (
            <Menu className="h-5 w-5 text-muted-foreground" />
          )}
        </button>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-30 bg-black/40" onClick={closeMobile}>
          <aside
            className="absolute left-0 top-0 bottom-0 w-64 bg-sidebar"
            onClick={e => e.stopPropagation()}
          >
            <SidebarContent
              pathname={clientPathname}
              onLogout={handleLogout}
              loggingOut={loggingOut}
              onMobileClose={closeMobile}
              isOwner={isOwner}
              allowedPages={allowedPages}
            />
          </aside>
        </div>
      )}
    </>
  )
}