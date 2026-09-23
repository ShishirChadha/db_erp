'use client'

import { useEffect, useState } from 'react'
import { PriceTag } from './PriceTag'
import { AddToCartButton } from './AddToCartButton'
import { WhatsAppOrderButton } from './WhatsAppOrderButton'

// Looks up its target by id (rather than a ref) because it's a sibling of the
// observed element, not an ancestor -- a ref can't cross that boundary as a
// prop from a server component. z-30, one below WhatsAppButton's global
// z-40 fixed bubble (app/layout.tsx), and right-padded so the bar's own
// content never sits directly under the WhatsApp bubble on mobile.
export function StickyBuyBar({
  price,
  marketPrice,
  skuId,
  disabled,
  whatsappHref,
}: {
  price: number
  marketPrice: number | null
  skuId: string
  disabled?: boolean
  whatsappHref: string
}) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const target = document.getElementById('main-buy-cta')
    if (!target) return
    const observer = new IntersectionObserver(([entry]) => setVisible(!entry.isIntersecting), {
      rootMargin: '0px 0px -10% 0px',
    })
    observer.observe(target)
    return () => observer.disconnect()
  }, [])

  if (!visible) return null

  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 p-3 pr-16 backdrop-blur sm:hidden">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <PriceTag price={price} marketPrice={marketPrice} />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <WhatsAppOrderButton href={whatsappHref} compact />
          <div className="w-24">
            <AddToCartButton skuId={skuId} disabled={disabled} />
          </div>
        </div>
      </div>
    </div>
  )
}
