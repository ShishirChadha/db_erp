'use client'

import { Suspense } from 'react'
import RequireOwner from '@/components/RequireOwner'
import PriceBoard from '@/components/pricing/PriceBoard'

export default function PriceBoardPage() {
  return (
    <RequireOwner>
      <Suspense fallback={<div className="p-4 text-sm text-muted-foreground">Loading…</div>}>
        <PriceBoard />
      </Suspense>
    </RequireOwner>
  )
}
