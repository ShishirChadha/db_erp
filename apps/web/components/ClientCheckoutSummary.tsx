'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserSupabaseClient } from '@db/db/browser'
import { formatCurrency } from '@db/shared'
import type { GuestLine } from '@/lib/guest-cart'
import { productDisplayTitle } from '@/lib/product-title'
import { CheckoutForm } from './CheckoutForm'
import type { PaymentSettings } from '@/lib/payment-settings'

interface Row {
  line: GuestLine
  title: string
  price: number
  soldOut: boolean
}

// Re-prices and summarises a client-known line list before handing it to
// CheckoutForm -- the one piece of work shared by every checkout path that
// can't be server-rendered: a guest's full cart (no session to read
// cart_items with) and a "Buy Now" express checkout (deliberately bypasses
// cart_items even when signed in -- see lib/buy-now.ts). Checkout/start
// re-prices everything again from public_products regardless, so nothing
// here is ever trusted for money -- this is purely what the customer sees
// before paying.
export function ClientCheckoutSummary({
  lines,
  paymentSettings,
  mode,
  customerName,
  customerEmail,
  onSuccess,
  emptyRedirect,
}: {
  lines: GuestLine[]
  paymentSettings: PaymentSettings
  mode: 'account' | 'guest'
  customerName: string
  customerEmail: string
  onSuccess?: () => void
  // Where to send the customer if `lines` turns out empty or entirely sold
  // out -- /cart for the guest-cart case, the product page itself for a Buy
  // Now click that got here with nothing in sessionStorage.
  emptyRedirect: string
}) {
  const router = useRouter()
  const [rows, setRows] = useState<Row[] | null>(null)

  useEffect(() => {
    async function load() {
      if (lines.length === 0) {
        router.replace(emptyRedirect)
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
        router.replace(emptyRedirect)
        return
      }
      setRows(resolved)
    }
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (rows === null) return <p className="mt-6 text-sm text-muted-foreground">Loading…</p>

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
          customerName={customerName}
          customerEmail={customerEmail}
          paymentSettings={paymentSettings}
          mode={mode}
          items={rows.map((r) => r.line)}
          onSuccess={onSuccess}
        />
      </div>
    </>
  )
}
