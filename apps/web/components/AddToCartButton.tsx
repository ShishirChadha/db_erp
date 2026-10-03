'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserSupabaseClient } from '@db/db/browser'
import { sortSelectedUpgrades, type SelectedUpgrade } from '@/lib/upgrades'
import { track, type GaItem } from '@/lib/analytics'

export function AddToCartButton({
  skuId,
  disabled,
  selectedUpgrades = [],
  item,
}: {
  skuId: string
  disabled?: boolean
  selectedUpgrades?: SelectedUpgrade[]
  // Product details for the GA4 add_to_cart payload. Passed in rather than
  // fetched here: the callers already hold the product record, and a button
  // should not issue a query to describe what it is adding. Optional so a
  // caller without the data degrades to no event rather than no button.
  item?: GaItem
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [added, setAdded] = useState(false)

  const handleClick = async () => {
    setPending(true)
    try {
      const supabase = createBrowserSupabaseClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        router.push(`/login?next=${encodeURIComponent(window.location.pathname)}`)
        return
      }

      const upgrades = sortSelectedUpgrades(selectedUpgrades)

      // Must also match on selected_upgrades -- two cart lines for the same
      // SKU with different upgrade choices are distinct lines, not the same
      // one with a bumped quantity.
      const { data: existing } = await supabase
        .from('cart_items')
        .select('id, quantity')
        .eq('customer_id', user.id)
        .eq('sku_id', skuId)
        .eq('selected_upgrades', upgrades)
        .maybeSingle()

      if (existing) {
        await supabase.from('cart_items').update({ quantity: existing.quantity + 1 }).eq('id', existing.id)
      } else {
        await supabase.from('cart_items').insert({ customer_id: user.id, sku_id: skuId, quantity: 1, selected_upgrades: upgrades })
      }

      // After the write, never before -- an add_to_cart that did not persist
      // would inflate the funnel's first step and make the drop-off to
      // checkout look worse than it is.
      if (item) {
        const upgradeDelta = upgrades.reduce((sum, u) => sum + (u.price_delta ?? 0), 0)
        const priced = { ...item, price: item.price + upgradeDelta }
        track({
          name: 'add_to_cart',
          params: { currency: 'INR', value: priced.price * priced.quantity, items: [priced] },
        })
      }

      setAdded(true)
      router.refresh()
      setTimeout(() => setAdded(false), 2000)
    } finally {
      setPending(false)
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled || pending}
      className={`w-full rounded-full px-4 py-3 text-sm font-semibold transition-opacity disabled:opacity-50 ${
        added ? 'bg-emerald-600 text-white' : 'bg-brand-orange text-white hover:opacity-90'
      }`}
    >
      {disabled ? 'Sold out' : added ? 'Added to cart' : pending ? 'Adding…' : 'Add to cart'}
    </button>
  )
}
