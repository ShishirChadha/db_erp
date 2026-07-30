import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@db/db/server'
import { getCustomerSession } from '@/lib/customer-session'
import { formatCurrency } from '@db/shared'
import { CheckoutForm } from '@/components/CheckoutForm'

export const dynamic = 'force-dynamic'

export default async function CheckoutPage() {
  const session = await getCustomerSession()
  if (!session) redirect('/login?next=/checkout')

  const supabase = await createServerSupabaseClient()
  const { data: cartItems } = await supabase.from('cart_items').select('sku_id, quantity').eq('customer_id', session.id)

  if (!cartItems || cartItems.length === 0) redirect('/cart')

  const { data: products } = await supabase
    .from('public_products')
    .select('id, web_title, web_price, availability_bucket')
    .in('id', cartItems.map((c) => c.sku_id))
  const productById = new Map((products ?? []).map((p) => [p.id, p]))

  if (cartItems.some((c) => {
    const p = productById.get(c.sku_id)
    return !p || p.availability_bucket === 'sold_out'
  })) {
    redirect('/cart')
  }

  const subtotal = cartItems.reduce((sum, c) => sum + (productById.get(c.sku_id)?.web_price ?? 0) * c.quantity, 0)

  return (
    <main className="mx-auto max-w-lg px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Checkout</h1>

      <div className="mt-4 rounded-md border border-border p-4 text-sm">
        {cartItems.map((c) => {
          const p = productById.get(c.sku_id)
          return (
            <div key={c.sku_id} className="flex justify-between py-1">
              <span className="text-muted-foreground">{p?.web_title} × {c.quantity}</span>
              <span className="tabular-nums">{formatCurrency((p?.web_price ?? 0) * c.quantity)}</span>
            </div>
          )
        })}
        <div className="mt-2 flex justify-between border-t border-border pt-2 font-medium">
          <span>Total</span>
          <span className="tabular-nums">{formatCurrency(subtotal)}</span>
        </div>
      </div>

      <div className="mt-6">
        <CheckoutForm subtotal={subtotal} customerName={session.fullName || ''} customerEmail={session.email || ''} />
      </div>
    </main>
  )
}
