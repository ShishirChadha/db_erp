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
  BarChart3,
  LogOut,
  Laptop,
  Menu,
  X,
  Building2,
  Barcode,
  FileText,
  Settings,
  Sparkles,
  CalendarDays,
  ChevronDown,
  PackagePlus,
  Wrench,
  Loader2,
  ListChecks,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useRole } from '@/lib/auth/useRole'
import { useAsyncAction } from '@/lib/useAsyncAction'


// ---------- Menu structure with categories ----------
// ownerOnly: hidden from the sidebar entirely for the 'employee' role. This is nav
// convenience only -- every underlying API route enforces the same restriction itself.
const menuGroups = [
  {
    label: 'Dashboard',
    icon: LayoutDashboard,
    href: '/dashboard',
    pageKey: 'dashboard',
  },
  {
    label: 'Pending Tasks',
    icon: ListChecks,
    href: '/dashboard/pending-tasks',
    pageKey: 'pending_tasks',
  },
  {
    label: 'New Entry',
    icon: PackagePlus,
    href: '/dashboard/entry',
    pageKey: 'new_entry',
  },
  {
    label: 'Accessories',
    icon: Sparkles,
    href: '/dashboard/accessories',
    pageKey: 'accessories',
  },
  {
    label: 'Purchases',
    icon: ShoppingCart,
    ownerOnly: true,
    children: [
      { href: '/dashboard/purchase-orders', label: 'Purchase Orders' },
      { href: '/dashboard/purchase-invoices', label: 'Purchase Invoices' },
      { href: '/dashboard/purchases', label: 'OLD Purchase IN' },
    ],
  },
  {
    label: 'Inventory',
    icon: Barcode,
    children: [
      { href: '/dashboard/sku-master', label: 'SKU Master', pageKey: 'sku_master' },
      { href: '/dashboard/live-stock', label: 'Live Stock', pageKey: 'live_stock' },
      { href: '/dashboard/stock', label: 'Stock / Assets (Main ERP)', ownerOnly: true },
    ],
  },
  {
    label: 'Sales',
    icon: TrendingUp,
    children: [
      { href: '/dashboard/sales', label: 'Sales', ownerOnly: true },
      { href: '/dashboard/invoices', label: 'Invoices', pageKey: 'invoices' },
      { href: '/dashboard/quotations', label: 'Quotations', ownerOnly: true },
    ],
  },
  {
    label: 'Contacts',
    icon: Users,
    children: [
      { href: '/dashboard/customers', label: 'Customers', pageKey: 'customers' },
      { href: '/dashboard/vendors', label: 'Vendors', ownerOnly: true },
    ],
  },
  {
    label: 'Service',
    icon: Wrench,
    children: [
      { href: '/dashboard/repair-jobs', label: 'Repair Jobs', pageKey: 'repair_jobs' },
      { href: '/dashboard/rma', label: 'RMA (Vendor Returns)', ownerOnly: true },
    ],
  },
  {
    label: 'Finance',
    icon: Receipt,
    ownerOnly: true,
    children: [
      { href: '/dashboard/expenses', label: 'Expenses' },
      { href: '/dashboard/reports', label: 'Reports' },
    ],
  },
  {
    label: 'Activity Hub',
    icon: CalendarDays,
    href: '/dashboard/activities',
    pageKey: 'activities',
  },
  {
    label: 'Settings',
    icon: Settings,
    href: '/dashboard/settings',
    ownerOnly: true,
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

  const visibleGroups = useMemo(
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

  // State for each group (key = label) whether it's open
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    // Initialize: open the group if it contains the current path
    const initial: Record<string, boolean> = {}
    menuGroups.forEach(group => {
      if (group.children) {
        initial[group.label] = group.children.some(child => pathname.startsWith(child.href))
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
          const isActive = group.children.some(child => pathname.startsWith(child.href))
          if (isActive) next[group.label] = true
        }
      })
      return next
    })
  }, [pathname])

  const toggleGroup = (label: string) => {
    setOpenGroups(prev => ({ ...prev, [label]: !prev[label] }))
  }

  return (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 py-5 border-b border-gray-200">
        <div className="bg-blue-600 p-2 rounded-xl">
          <Laptop className="h-5 w-5 text-white" />
        </div>
        <div>
          <p className="font-semibold text-gray-900 text-sm">DigitalBluez</p>
          <p className="text-xs text-gray-400">ERP System</p>
        </div>
      </div>

      {/* Nav items */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {visibleGroups.map(group => {
          // If it has children, render a collapsible group
          if (group.children) {
            const isOpen = openGroups[group.label] ?? false
            const isActive = group.children.some(child => pathname === child.href)

            return (
              <div key={group.label}>
                <button
                  onClick={() => toggleGroup(group.label)}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all w-full',
                    isActive
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
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
                        <Link
                          key={child.href}
                          href={child.href}
                          onClick={onMobileClose}
                          className={cn(
                            'flex items-center gap-3 px-3 py-2 rounded-xl text-sm transition-all',
                            childActive
                              ? 'bg-blue-100 text-blue-700 font-medium'
                              : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
                          )}
                        >
                          {child.label}
                        </Link>
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
              key={group.href || group.label}
              href={group.href!}
              onClick={onMobileClose}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all',
                isActive
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              )}
            >
              {group.icon && <group.icon className="h-4 w-4 flex-shrink-0" />}
              {group.label}
            </Link>
          )
        })}
      </nav>

      {/* Logout */}
      <div className="px-3 py-4 border-t border-gray-200">
        <button
          onClick={onLogout}
          disabled={loggingOut}
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-gray-600 hover:bg-red-50 hover:text-red-600 transition-all w-full disabled:opacity-50"
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
      <aside className="hidden md:flex w-56 bg-white border-r border-gray-200 flex-col flex-shrink-0">
        {sidebarContent}
      </aside>

      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-40 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="bg-blue-600 p-1.5 rounded-lg">
            <Laptop className="h-4 w-4 text-white" />
          </div>
          <span className="font-semibold text-gray-900 text-sm">DigitalBluez ERP</span>
        </div>
        <button onClick={toggleMobile}>
          {mobileOpen ? (
            <X className="h-5 w-5 text-gray-600" />
          ) : (
            <Menu className="h-5 w-5 text-gray-600" />
          )}
        </button>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-30 bg-black/40" onClick={closeMobile}>
          <aside
            className="absolute left-0 top-0 bottom-0 w-64 bg-white"
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