'use client'

import { useState } from 'react'
import { formatCurrency } from '@db/shared'
import type { UpgradeOption } from '@/lib/queries'
import type { SelectedUpgrade } from '@/lib/upgrades'
import { UpgradeSelector } from './UpgradeSelector'
import { AddToCartButton } from './AddToCartButton'
import { WhatsAppOrderButton } from './WhatsAppOrderButton'

// Holds the upgrade-selection state so both the selector and the buy button
// share it. Scope note: the sticky mobile buy bar (rendered separately,
// outside this tree) intentionally adds the plain base product without any
// selected upgrades -- the fully upgrade-aware Add to Cart lives here, in the
// main content, which is where the selector itself is anyway.
export function PurchaseUpgradeArea({
  skuId,
  basePrice,
  disabled,
  options,
  whatsappHref,
}: {
  skuId: string
  basePrice: number
  disabled: boolean
  options: UpgradeOption[]
  whatsappHref: string
}) {
  const [selected, setSelected] = useState<SelectedUpgrade[]>([])
  const upgradeTotal = selected.reduce((sum, u) => sum + u.price_delta, 0)

  return (
    <div>
      <UpgradeSelector options={options} onChange={setSelected} />
      {upgradeTotal > 0 && (
        <p className="mt-3 text-sm font-semibold text-foreground">
          Total with upgrades: {formatCurrency(basePrice + upgradeTotal)}
        </p>
      )}
      <div id="main-buy-cta" className="mt-3 flex flex-col gap-2">
        <WhatsAppOrderButton href={whatsappHref} />
        <AddToCartButton skuId={skuId} disabled={disabled} selectedUpgrades={selected} />
      </div>
    </div>
  )
}
