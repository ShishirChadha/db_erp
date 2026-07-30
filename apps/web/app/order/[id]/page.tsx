import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { createServerSupabaseClient } from '@db/db/server'
import { getCustomerSession } from '@/lib/customer-session'
import { formatCurrency } from '@db/shared'
import { OrderStatusPoller } from '@/components/OrderStatusPoller'

export const dynamic = 'force-dynamic'

const STATUS_LABEL: Record<string, string> = {
  pending_payment: 'Confirming payment…',
  paid: 'Order confirmed',
  cancelled: 'Order cancelled',
  expired: 'Checkout expired',
}

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getCustomerSession()
  if (!session) redirect(`/login`)

  const { id } = await params
  const supabase = await createServerSupabaseClient()
  const { data: order } = await supabase.from('orders').select('*').eq('id', id).single()
  if (!order) notFound()

  const { data: items } = await supabase
    .from('order_items')
    .select('id, title_snapshot, quantity, unit_price')
    .eq('order_id', id)

  return (
    <main className="mx-auto max-w-lg px-4 py-14 sm:px-6">
      {order.status === 'pending_payment' && <OrderStatusPoller />}

      <h1 className="text-2xl font-semibold tracking-tight text-foreground">{STATUS_LABEL[order.status] || order.status}</h1>
      <p className="mt-1 text-sm text-muted-foreground">Order #{order.id.slice(0, 8)}</p>

      {order.status === 'pending_payment' && (
        <p className="mt-4 text-sm text-muted-foreground">
          This usually takes a few seconds. This page will update automatically.
        </p>
      )}

      {(order.status === 'cancelled' || order.status === 'expired') && (
        <p className="mt-4 text-sm text-muted-foreground">
          This order didn&apos;t go through. Nothing was charged. <Link href="/cart" className="underline">Return to your cart</Link>.
        </p>
      )}

      <div className="mt-6 rounded-md border border-border p-4 text-sm">
        {(items ?? []).map((item) => (
          <div key={item.id} className="flex justify-between py-1">
            <span className="text-muted-foreground">{item.title_snapshot} × {item.quantity}</span>
            <span className="tabular-nums">{formatCurrency(item.unit_price * item.quantity)}</span>
          </div>
        ))}
        <div className="mt-2 flex justify-between border-t border-border pt-2 font-medium text-foreground">
          <span>Total</span>
          <span className="tabular-nums">{formatCurrency(order.total_amount)}</span>
        </div>
      </div>

      {order.status === 'paid' && (
        <Link href="/account/orders" className="mt-6 block text-center text-sm font-medium text-foreground underline">
          View order history
        </Link>
      )}
    </main>
  )
}
