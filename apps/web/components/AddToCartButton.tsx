'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserSupabaseClient } from '@db/db/browser'
import { sortSelectedUpgrades, type SelectedUpgrade } from '@/lib/upgrades'
import { track, type GaItem } from '@/lib/analytics'
import { addToGuestCart } from '@/lib/guest-cart'

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
  // Guest carts are capped (see lib/guest-cart.ts) -- say so rather than
  // silently dropping the item.
  const [full, setFull] = useState<'cart_full' | 'line_full' | null>(null)

  const handleClick = async () => {
    setFull(null)
    setPending(true)
    try {
      const supabase = createBrowserSupabaseClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()
      const upgrades = sortSelectedUpgrades(selectedUpgrades)

      // Not signed in: keep the item in a local guest cart instead of bouncing
      // them to /login. Requiring an account before you can even put something
      // in a basket is the kind of friction that loses the sale outright -- the
      // account is only genuinely needed at checkout, where the order and the
      // stock reservation have to belong to someone.
      //
      // The guest cart is merged into the real one by mergeGuestCartIfAny() on
      // the login transition.
      if (!user) {
        const result = addToGuestCart(skuId, upgrades)
        if (result !== 'added') {
          setFull(result)
          return
        }
        if (item) {
          const upgradeDelta = upgrades.reduce((sum, u) => sum + (u.price_delta ?? 0), 0)
          const priced = { ...item, price: item.price + upgradeDelta }
          track({
            name: 'add_to_cart',
            params: { currency: 'INR', value: priced.price * priced.quantity, items: [priced] },
          })
        }
        setAdded(true)
        setTimeout(() => setAdded(false), 2000)
        return
      }

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
    <div>
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
      {full && (
        <p className="mt-2 text-xs text-red-600">
          {full === 'line_full'
            ? 'That is the most you can add of this item.'
            : 'Your cart is full. Please check out or remove something first.'}
        </p>
      )}
    </div>
  )
}
