'use client'

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
  Building2
} from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/utils'


const navItems = [
  { href: '/dashboard',           label: 'Dashboard',    icon: LayoutDashboard },
  { href: '/dashboard/purchases', label: 'Purchase IN',  icon: ShoppingCart },
  { href: '/dashboard/sales',     label: 'Sales',        icon: TrendingUp },
  { href: '/dashboard/expenses',  label: 'Expenses',     icon: Receipt },
  { href: '/dashboard/customers', label: 'Customers',    icon: Users },
  { href: '/dashboard/vendors',   label: 'Vendors',      icon: Building2 },
  { href: '/dashboard/reports',   label: 'Reports',      icon: BarChart3 },
]

export default function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()
  const [mobileOpen, setMobileOpen] = useState(false)

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const SidebarContent = () => (
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
      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.map((item) => {
          const isActive = pathname === item.href
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all',
                isActive
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              )}
            >
              <item.icon className="h-4 w-4 flex-shrink-0" />
              {item.label}
            </Link>
          )
        })}
      </nav>

      {/* Logout */}
      <div className="px-3 py-4 border-t border-gray-200">
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-gray-600 hover:bg-red-50 hover:text-red-600 transition-all w-full"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </div>

    </div>
  )

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-56 bg-white border-r border-gray-200 flex-col flex-shrink-0">
        <SidebarContent />
      </aside>

      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-40 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="bg-blue-600 p-1.5 rounded-lg">
            <Laptop className="h-4 w-4 text-white" />
          </div>
          <span className="font-semibold text-gray-900 text-sm">DigitalBluez ERP</span>
        </div>
        <button onClick={() => setMobileOpen(!mobileOpen)}>
          {mobileOpen
            ? <X className="h-5 w-5 text-gray-600" />
            : <Menu className="h-5 w-5 text-gray-600" />
          }
        </button>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-30 bg-black/40" onClick={() => setMobileOpen(false)}>
          <aside
            className="absolute left-0 top-0 bottom-0 w-64 bg-white"
            onClick={(e) => e.stopPropagation()}
          >
            <SidebarContent />
          </aside>
        </div>
      )}
    </>
  )
}