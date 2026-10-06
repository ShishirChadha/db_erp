'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserSupabaseClient } from '@db/db/browser'
import { formatCurrency } from '@db/shared'
import { readGuestCart, type GuestLine } from '@/lib/guest-cart'
import { productDisplayTitle } from '@/lib/product-title'
import { CheckoutForm } from './CheckoutForm'
import type { PaymentSettings } from '@/lib/payment-settings'

interface Row {
  line: GuestLine
  title: string
  price: number
  soldOut: boolean
}

// The guest-checkout counterpart to the account path's server-rendered cart
// summary in checkout/page.tsx -- a server component can't read localStorage,
// so this loads and re-prices the guest cart itself client-side, same
// pattern GuestCart.tsx already uses on /cart. The lines it resolves here are
// what gets sent to /api/checkout/start as guestLines; that route re-prices
// everything again from public_products regardless, so nothing here is ever
// trusted for money.
export function GuestCheckoutSummary({ paymentSettings }: { paymentSettings: PaymentSettings }) {
  const router = useRouter()
  const [rows, setRows] = useState<Row[] | null>(null)

  useEffect(() => {
    async function load() {
      const lines = readGuestCart()
      if (lines.length === 0) {
        router.replace('/cart')
        return
      }
      const supabase = createBrowserSupabaseClient()
      const { data: products } = await supabase
        .from('public_products')
        .select('id, web_title, category, specifications, web_price, availability_bucket')
        .in('id', lines.map((l) => l.sku_id))
      const byId = new Map<string, any>(((products ?? []) as any[]).map((p) => [p.id as string, p]))

      const resolved = lines.map((line) => {
        const p = byId.get(line.sku_id)
        return {
          line,
          title: p ? productDisplayTitle(p) : 'No longer available',
          price: p?.web_price ?? 0,
          soldOut: !p || p.availability_bucket === 'sold_out',
        }
      })
      if (resolved.some((r) => r.soldOut)) {
        router.replace('/cart')
        return
      }
      setRows(resolved)
    }
    load()
  }, [router])

  if (rows === null) return <p className="mt-6 text-sm text-muted-foreground">Loading your cart…</p>

  const subtotal = rows.reduce((sum, r) => sum + r.price * r.line.quantity, 0)

  return (
    <>
      <div className="mt-4 rounded-md border border-border p-4 text-sm">
        {rows.map((r) => (
          <div key={r.line.sku_id} className="flex justify-between py-1">
            <span className="text-muted-foreground">{r.title} × {r.line.quantity}</span>
            <span className="tabular-nums">{formatCurrency(r.price * r.line.quantity)}</span>
          </div>
        ))}
        <div className="mt-2 flex justify-between border-t border-border pt-2 font-medium">
          <span>Total</span>
          <span className="tabular-nums">{formatCurrency(subtotal)}</span>
        </div>
      </div>

      <div className="mt-6">
        <CheckoutForm
          subtotal={subtotal}
          customerName=""
          customerEmail=""
          paymentSettings={paymentSettings}
          mode="guest"
          guestLines={rows.map((r) => r.line)}
        />
      </div>
    </>
  )
}
