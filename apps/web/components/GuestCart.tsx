'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { createBrowserSupabaseClient } from '@db/db/browser'
import { buildConfigSummary, formatCurrency } from '@db/shared'
import { productImageUrl } from '@/lib/image-url'
import { readGuestCart, setGuestLineQuantity, type GuestLine } from '@/lib/guest-cart'
import { track } from '@/lib/analytics'

interface Row {
  line: GuestLine
  title: string
  slug: string | null
  price: number
  imagePath: string | null
  soldOut: boolean
}

// The cart for a visitor who is not signed in.
//
// Re-prices against public_products with the anon key -- the same client-direct
// public read the header search already does, so no new API route. The stored
// cart holds only sku_id and quantity, never a price: a price in localStorage
// would be user-editable, and checkout re-prices server-side anyway.
export function GuestCart() {
  const [rows, setRows] = useState<Row[] | null>(null)

  const load = useCallback(async () => {
    const lines = readGuestCart()
    if (lines.length === 0) {
      setRows([])
      return
    }
    const supabase = createBrowserSupabaseClient()
    const [{ data: products }, { data: templates }] = await Promise.all([
      supabase
        .from('public_products')
        .select('id, web_slug, web_title, category, specifications, web_price, primary_image_path, availability_bucket')
        .in('id', lines.map((l) => l.sku_id)),
      supabase.from('public_categories').select('category, field_schema'),
    ])
    // public_products isn't in the generated types for the browser client,
    // so the row shape is annotated rather than inferred.
    const byId = new Map<string, any>(((products ?? []) as any[]).map((p) => [p.id as string, p]))
    setRows(
      lines.map((line) => {
        const p = byId.get(line.sku_id)
        return {
          line,
          title:
            (p?.web_title || (p && buildConfigSummary(p.category, p.specifications, (templates ?? []) as any))) ||
            'No longer available',
          slug: p?.web_slug ?? null,
          price: p?.web_price ?? 0,
          imagePath: p?.primary_image_path ?? null,
          soldOut: !p || p.availability_bucket === 'sold_out',
        }
      }),
    )
  }, [])

  useEffect(() => {
    load()
    const onChange = () => load()
    window.addEventListener('db-guest-cart-changed', onChange)
    return () => window.removeEventListener('db-guest-cart-changed', onChange)
  }, [load])

  useEffect(() => {
    if (!rows || rows.length === 0) return
    track({
      name: 'view_cart',
      params: {
        currency: 'INR',
        value: rows.reduce((sum, r) => sum + (r.soldOut ? 0 : r.price * r.line.quantity), 0),
        items: rows.map((r) => ({
          item_id: r.line.sku_id,
          item_name: r.title,
          price: r.soldOut ? 0 : r.price,
          quantity: r.line.quantity,
        })),
      },
    })
    // Once per mount, not on every quantity tweak.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows === null])

  if (rows === null) return <p className="mt-8 text-sm text-muted-foreground">Loading…</p>

  if (rows.length === 0) {
    return (
      <p className="mt-8 rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        Your cart is empty. <Link href="/" className="text-brand-orange underline">Continue shopping</Link>.
      </p>
    )
  }

  const subtotal = rows.reduce((sum, r) => sum + (r.soldOut ? 0 : r.price * r.line.quantity), 0)
  const hasSoldOut = rows.some((r) => r.soldOut)

  return (
    <>
      <div className="mt-6 rounded-xl border border-border px-4">
        {rows.map((r) => (
          <div key={`${r.line.sku_id}-${JSON.stringify(r.line.selected_upgrades)}`}
               className="flex items-center gap-4 border-b border-border py-4 last:border-b-0">
            <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md bg-muted">
              {r.imagePath && <Image src={productImageUrl(r.imagePath)} alt={r.title} fill sizes="64px" className="object-cover" />}
            </div>
            <div className="min-w-0 flex-1">
              {r.slug ? (
                <Link href={`/product/${r.slug}`} className="line-clamp-1 text-sm font-medium text-foreground hover:underline">
                  {r.title}
                </Link>
              ) : (
                <p className="line-clamp-1 text-sm font-medium text-foreground">{r.title}</p>
              )}
              {r.soldOut && <p className="text-xs text-red-600">No longer available</p>}
              <p className="text-sm tabular-nums text-muted-foreground">{formatCurrency(r.price)}</p>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" className="size-11 rounded-md border border-border text-sm"
                onClick={() => { setGuestLineQuantity(r.line.sku_id, r.line.selected_upgrades, r.line.quantity - 1); load() }}>
                −
              </button>
              <span className="w-6 text-center text-sm tabular-nums">{r.line.quantity}</span>
              <button type="button" className="size-11 rounded-md border border-border text-sm"
                onClick={() => { setGuestLineQuantity(r.line.sku_id, r.line.selected_upgrades, r.line.quantity + 1); load() }}>
                +
              </button>
            </div>
            <p className="w-20 shrink-0 text-right text-sm font-medium tabular-nums text-foreground">
              {formatCurrency(r.price * r.line.quantity)}
            </p>
          </div>
        ))}
      </div>

      {hasSoldOut && (
        <p className="mt-3 text-sm text-red-600">
          Remove unavailable items above before checking out.
        </p>
      )}

      <div className="mt-6 flex items-center justify-between border-t border-border pt-4">
        <span className="text-sm text-muted-foreground">Subtotal</span>
        <span className="text-lg font-semibold tabular-nums text-foreground">{formatCurrency(subtotal)}</span>
      </div>

      {/* An account is genuinely required from here: the order and the stock
          reservation have to belong to someone. The cart carries over on login. */}
      <Link
        href="/login?next=/checkout"
        className="mt-4 block w-full rounded-full bg-brand-orange px-4 py-3 text-center text-sm font-semibold text-white hover:opacity-90"
      >
        Log in to check out
      </Link>
      <p className="mt-2 text-center text-xs text-muted-foreground">
        Your cart will be waiting for you after you log in.
      </p>
    </>
  )
}
