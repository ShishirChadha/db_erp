'use client'

import { useRouter } from 'next/navigation'
import { useWishlist } from './WishlistProvider'

export function WishlistButton({ skuId, className }: { skuId: string; className?: string }) {
  const router = useRouter()
  const { ready, isSaved, isPending, toggle } = useWishlist()
  const saved = isSaved(skuId)
  const pending = isPending(skuId)

  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const result = await toggle(skuId)
    if (result === 'login-required') {
      router.push(`/login?next=${encodeURIComponent(window.location.pathname)}`)
      return
    }
    router.refresh()
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending || !ready}
      aria-label={saved ? 'Remove from wishlist' : 'Save to wishlist'}
      aria-pressed={saved}
      className={`inline-flex items-center justify-center rounded-full border border-border bg-card/90 p-2.5 backdrop-blur transition-colors hover:border-brand-orange/40 disabled:opacity-50 ${className || ''}`}
    >
      <svg
        viewBox="0 0 24 24"
        className={`h-4.5 w-4.5 transition-colors ${saved ? 'fill-brand-orange text-brand-orange' : 'fill-none text-muted-foreground'}`}
        stroke="currentColor"
        strokeWidth="1.8"
      >
        <path d="M12 20.5s-7.5-4.8-10-9.4C.6 8 1.6 4.5 4.6 3.4c2.3-.9 4.6.1 5.9 2 .5.7.8 1.1 1.5 1.1s1-.4 1.5-1.1c1.3-1.9 3.6-2.9 5.9-2 3 1.1 4 4.6 2.6 7.7-2.5 4.6-10 9.4-10 9.4z" />
      </svg>
    </button>
  )
}
