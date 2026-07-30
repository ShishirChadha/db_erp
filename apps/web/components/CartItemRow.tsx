'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import { createBrowserSupabaseClient } from '@db/db/browser'
import { formatCurrency } from '@db/shared'
import { productImageUrl } from '@/lib/image-url'

export function CartItemRow({
  cartItemId,
  title,
  slug,
  price,
  quantity,
  imagePath,
  soldOut,
}: {
  cartItemId: string
  title: string
  slug: string | null
  price: number
  quantity: number
  imagePath: string | null
  soldOut: boolean
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  const updateQuantity = async (next: number) => {
    setPending(true)
    const supabase = createBrowserSupabaseClient()
    if (next <= 0) {
      await supabase.from('cart_items').delete().eq('id', cartItemId)
    } else {
      await supabase.from('cart_items').update({ quantity: next }).eq('id', cartItemId)
    }
    router.refresh()
    setPending(false)
  }

  return (
    <div className="flex items-center gap-4 border-b border-border py-4 last:border-b-0">
      <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md bg-muted">
        {imagePath && <Image src={productImageUrl(imagePath)} alt={title} fill sizes="64px" className="object-cover" />}
      </div>
      <div className="min-w-0 flex-1">
        {slug ? (
          <Link href={`/product/${slug}`} className="line-clamp-1 text-sm font-medium text-foreground hover:underline">
            {title}
          </Link>
        ) : (
          <p className="line-clamp-1 text-sm font-medium text-foreground">{title}</p>
        )}
        {soldOut && <p className="text-xs text-red-600">No longer available</p>}
        <p className="text-sm tabular-nums text-muted-foreground">{formatCurrency(price)}</p>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => updateQuantity(quantity - 1)}
          className="size-7 rounded-md border border-border text-sm disabled:opacity-50"
        >
          −
        </button>
        <span className="w-6 text-center text-sm tabular-nums">{quantity}</span>
        <button
          type="button"
          disabled={pending}
          onClick={() => updateQuantity(quantity + 1)}
          className="size-7 rounded-md border border-border text-sm disabled:opacity-50"
        >
          +
        </button>
      </div>
      <p className="w-20 shrink-0 text-right text-sm font-medium tabular-nums text-foreground">
        {formatCurrency(price * quantity)}
      </p>
    </div>
  )
}
