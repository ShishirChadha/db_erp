'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { sortSelectedUpgrades, type SelectedUpgrade } from '@/lib/upgrades'
import { setBuyNowLine } from '@/lib/buy-now'
import { track, type GaItem } from '@/lib/analytics'

// Skips the cart entirely -- see lib/buy-now.ts. Same props as
// AddToCartButton so both can sit side by side off the same selected-
// upgrades state (PurchaseUpgradeArea), but this one never writes to
// cart_items or the guest cart; checkout/page.tsx reads the single line
// back out of sessionStorage.
export function BuyNowButton({
  skuId,
  disabled,
  selectedUpgrades = [],
  item,
}: {
  skuId: string
  disabled?: boolean
  selectedUpgrades?: SelectedUpgrade[]
  item?: GaItem
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  const handleClick = () => {
    setPending(true)
    const upgrades = sortSelectedUpgrades(selectedUpgrades)
    setBuyNowLine(skuId, upgrades)

    if (item) {
      const upgradeDelta = upgrades.reduce((sum, u) => sum + (u.price_delta ?? 0), 0)
      const priced = { ...item, price: item.price + upgradeDelta }
      // Same event checkout/page.tsx's existing flow fires on add -- a Buy
      // Now click is still functionally "added one item" from the funnel's
      // point of view, just skipping straight past the cart page.
      track({ name: 'add_to_cart', params: { currency: 'INR', value: priced.price * priced.quantity, items: [priced] } })
    }

    router.push('/checkout?buyNow=1')
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled || pending}
      className="w-full rounded-full border-2 border-brand-orange px-4 py-3 text-sm font-semibold text-brand-orange transition-colors hover:bg-brand-orange/10 disabled:opacity-50"
    >
      {disabled ? 'Sold out' : pending ? 'Loading…' : 'Buy now'}
    </button>
  )
}
