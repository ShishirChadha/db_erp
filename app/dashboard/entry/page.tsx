'use client'

import Link from 'next/link'
import { PackagePlus, ShoppingBag, Wrench } from 'lucide-react'
import RequirePageAccess from '@/components/RequirePageAccess'

const TILES = [
  {
    href: '/dashboard/entry/intake',
    label: 'Stock Intake',
    description: 'Register a laptop, desktop, or accessory you just received.',
    icon: PackagePlus,
    enabled: true,
  },
  {
    href: '/dashboard/entry/sell',
    label: 'Sell',
    description: 'Sell a unit or accessory to a customer.',
    icon: ShoppingBag,
    enabled: true,
  },
  {
    href: '/dashboard/entry/service',
    label: 'Service',
    description: 'Repair, replacement, or return.',
    icon: Wrench,
    enabled: true,
  },
]

function EntryLauncherPage() {
  return (
    <div className="p-4 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-1">New Entry</h1>
      <p className="text-sm text-gray-500 mb-6">What are you recording?</p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {TILES.map((tile) => {
          const Icon = tile.icon
          const content = (
            <div
              className={`flex flex-col items-center text-center gap-2 p-6 rounded-xl border bg-white shadow-sm transition-all ${
                tile.enabled ? 'hover:shadow-md hover:border-blue-300 cursor-pointer' : 'opacity-50 cursor-not-allowed'
              }`}
            >
              <Icon className="h-8 w-8 text-blue-600" />
              <span className="font-semibold text-gray-900">{tile.label}</span>
              <span className="text-xs text-gray-500">{tile.description}</span>
              {!tile.enabled && <span className="text-xs text-gray-400 mt-1">Coming soon</span>}
            </div>
          )
          return tile.enabled ? (
            <Link key={tile.href} href={tile.href}>{content}</Link>
          ) : (
            <div key={tile.href}>{content}</div>
          )
        })}
      </div>
    </div>
  )
}

export default function EntryLauncherPageGuarded() {
  return (
    <RequirePageAccess pageKey="new_entry">
      <EntryLauncherPage />
    </RequirePageAccess>
  )
}
