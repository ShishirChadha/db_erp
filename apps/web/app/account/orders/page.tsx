import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createServerSupabaseClient } from '@db/db/server'
import { getCustomerSession } from '@/lib/customer-session'
import { formatCurrency } from '@db/shared'

export const dynamic = 'force-dynamic'

const STATUS_LABEL: Record<string, string> = {
  pending_payment: 'Processing',
  paid: 'Paid',
  cancelled: 'Cancelled',
  expired: 'Expired',
}

export default async function OrderHistoryPage() {
  const session = await getCustomerSession()
  if (!session) redirect('/login?next=/account/orders')

  const supabase = await createServerSupabaseClient()
  const { data: orders } = await supabase
    .from('orders')
    .select('id, status, total_amount, created_at')
    .order('created_at', { ascending: false })

  return (
    <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Order history</h1>

      {!orders || orders.length === 0 ? (
        <p className="mt-8 text-sm text-muted-foreground">No orders yet.</p>
      ) : (
        <div className="mt-6 divide-y divide-border rounded-md border border-border">
          {orders.map((o) => (
            <Link key={o.id} href={`/order/${o.id}`} className="flex items-center justify-between px-4 py-3 text-sm hover:bg-muted/40">
              <div>
                <p className="font-medium text-foreground">#{o.id.slice(0, 8)}</p>
                <p className="text-xs text-muted-foreground">{new Date(o.created_at).toLocaleDateString('en-IN')}</p>
              </div>
              <div className="text-right">
                <p className="tabular-nums text-foreground">{formatCurrency(o.total_amount)}</p>
                <p className="text-xs text-muted-foreground">{STATUS_LABEL[o.status] || o.status}</p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  )
}
