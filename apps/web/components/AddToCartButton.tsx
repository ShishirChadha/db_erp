'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserSupabaseClient } from '@db/db/browser'
import { sortSelectedUpgrades, type SelectedUpgrade } from '@/lib/upgrades'

export function AddToCartButton({
  skuId,
  disabled,
  selectedUpgrades = [],
}: {
  skuId: string
  disabled?: boolean
  selectedUpgrades?: SelectedUpgrade[]
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
