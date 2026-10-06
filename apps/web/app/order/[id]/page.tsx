import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createServerSupabaseClient } from '@db/db/server'
import { supabaseAdmin } from '@db/db/admin'
import { getCustomerSession } from '@/lib/customer-session'
import { formatCurrency } from '@db/shared'
import { OrderStatusPoller } from '@/components/OrderStatusPoller'
import { ReservationCountdown } from '@/components/ReservationCountdown'
import { TrackPurchase } from '@/components/TrackPurchase'

export const dynamic = 'force-dynamic'

const STATUS_LABEL: Record<string, string> = {
  pending_payment: 'Confirming payment…',
  partially_paid: 'Order confirmed — balance due on delivery',
  paid: 'Order confirmed',
  cancelled: 'Order cancelled',
  expired: 'Checkout expired',
}

// A paid-or-settling order is a completed purchase from the customer's side
// -- COD only ever reaches 'partially_paid' from the webhook (the balance is
// cash at delivery, settled later in the ERP), so gating purely on 'paid'
// would never fire the purchase event for a COD order at all.
const COMPLETED_STATUSES = new Set(['paid', 'partially_paid'])

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getCustomerSession()
  const { id } = await params

  // Guest checkout (2026-10-06): an order placed without an account has
  // nobody to check RLS against, so a guest reads it via the admin client
  // instead. This is a deliberate, common tradeoff -- reaching this page at
  // all already requires the random order UUID, which only the browser that
  // just completed this specific checkout has (via its own redirect); it is
  // not guessable. A signed-in viewer still only ever sees their OWN orders,
  // enforced by the "Customers can view own orders" RLS policy on the normal
  // path below.
  let order: Record<string, any> | null = null
  if (session) {
    const supabase = await createServerSupabaseClient()
    const { data } = await supabase.from('orders').select('*').eq('id', id).single()
    order = data
  } else {
    const { data } = await supabaseAdmin.from('orders').select('*').eq('id', id).single()
    order = data
  }
  if (!order) notFound()

  const { data: items } = await supabaseAdmin
    .from('order_items')
    .select('id, title_snapshot, quantity, unit_price')
    .eq('order_id', id)

  // Same authoritative expiry source as checkout/start's response
  // (web_reservations.expires_at, written once by reserve_order_items) --
  // read directly here rather than re-deriving a TTL client-side, so the
  // countdown shown on this page never drifts from what the DB enforces.
  // web_reservations has no authenticated-role RLS policy (only service_role
  // is granted -- same reason reserve_order_items itself is only callable via
  // the service-role client per CLAUDE.md), so this read goes through
  // supabaseAdmin, scoped tightly to this order's own item ids only.
  let reservedUntil: string | null = null
  if (order.status === 'pending_payment' && items && items.length > 0) {
    const { data: reservationRow } = await supabaseAdmin
      .from('web_reservations')
      .select('expires_at')
      .in('order_item_id', items.map((i) => i.id))
      .is('released_at', null)
      .order('expires_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    reservedUntil = reservationRow?.expires_at ?? null
  }

  const isCod = order.payment_method === 'cod'
  const paidNow = isCod ? Number(order.token_amount ?? 0) : Number(order.total_amount)
  const balanceDue = isCod ? Math.round((Number(order.total_amount) - paidNow) * 100) / 100 : 0

  return (
    <main className="mx-auto max-w-lg px-4 py-14 sm:px-6">
      {order.status === 'pending_payment' && <OrderStatusPoller />}

      {/* Reported from committed paid/partially_paid state rather than the
          Razorpay callback, and deduped per order inside the component --
          this page refreshes itself while pending, so it remounts the
          moment the webhook lands. */}
      {COMPLETED_STATUSES.has(order.status) && (
        <TrackPurchase
          orderId={order.id}
          value={Number(order.total_amount)}
          discount={order.discount_amount ? Number(order.discount_amount) : undefined}
          items={(items || []).map((item: any) => ({
            item_id: item.id,
            item_name: item.title_snapshot || 'Item',
            price: Number(item.unit_price),
            quantity: item.quantity,
          }))}
        />
      )}

      <h1 className="text-2xl font-semibold tracking-tight text-foreground">{STATUS_LABEL[order.status] || order.status}</h1>
      <p className="mt-1 text-sm text-muted-foreground">Order #{order.id.slice(0, 8)}</p>

      {order.status === 'pending_payment' && (
        <div className="mt-4 space-y-1.5">
          <p className="text-sm text-muted-foreground">
            This usually takes a few seconds. This page will update automatically.
          </p>
          {reservedUntil && <ReservationCountdown expiresAt={reservedUntil} />}
        </div>
      )}

      {order.status === 'partially_paid' && (
        <p className="mt-4 text-sm text-muted-foreground">
          We&apos;ve received {formatCurrency(paidNow)} online. The remaining {formatCurrency(balanceDue)} is due in
          cash when your order is delivered.
        </p>
      )}

      {!session && COMPLETED_STATUSES.has(order.status) && (
        <p className="mt-4 text-sm text-muted-foreground">
          We&apos;ve set up an account for you with this email so you can track this order next time —
          check your inbox to set a password, or <Link href="/login" className="underline">log in</Link> once you have.
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
        {isCod && (
          <>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Paid online</span>
              <span className="tabular-nums">{formatCurrency(paidNow)}</span>
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Due on delivery</span>
              <span className="tabular-nums">{formatCurrency(balanceDue)}</span>
            </div>
          </>
        )}
      </div>

      {session && COMPLETED_STATUSES.has(order.status) && (
        <Link href="/account/orders" className="mt-6 block text-center text-sm font-medium text-foreground underline">
          View order history
        </Link>
      )}
    </main>
  )
}
