import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createServerSupabaseClient } from '@db/db/server'
import { getCustomerSession } from '@/lib/customer-session'
import { buildConfigSummary } from '@db/shared'
import { formatCurrency } from '@db/shared'
import { CartItemRow } from '@/components/CartItemRow'

export const dynamic = 'force-dynamic'

export default async function CartPage() {
  const session = await getCustomerSession()
  if (!session) redirect('/login?next=/cart')

  const supabase = await createServerSupabaseClient()
  const { data: cartItems } = await supabase
    .from('cart_items')
    .select('id, sku_id, quantity')
    .eq('customer_id', session.id)
    .order('created_at', { ascending: true })

  const skuIds = (cartItems ?? []).map((c) => c.sku_id)
  const [{ data: products }, { data: templates }] = await Promise.all([
    skuIds.length > 0
      ? supabase
          .from('public_products')
          .select('id, web_slug, web_title, category, specifications, brand, model_name, web_price, primary_image_path, availability_bucket')
          .in('id', skuIds)
      : Promise.resolve({ data: [] as any[] }),
    supabase.from('public_categories').select('category, field_schema'),
  ])

  const productById = new Map((products ?? []).map((p) => [p.id, p]))
  const rows = (cartItems ?? []).map((item) => {
    const product = productById.get(item.sku_id)
    const soldOut = !product || product.availability_bucket === 'sold_out'
    const title =
      (product?.web_title ||
        (product && buildConfigSummary(product.category, product.specifications, templates ?? []))) ||
      'No longer available'
    return {
      cartItemId: item.id,
      title,
      slug: product?.web_slug ?? null,
      price: product?.web_price ?? 0,
      quantity: item.quantity,
      imagePath: product?.primary_image_path ?? null,
      soldOut,
    }
  })

  const subtotal = rows.reduce((sum, r) => sum + (r.soldOut ? 0 : r.price * r.quantity), 0)
  const hasSoldOutItems = rows.some((r) => r.soldOut)
  const canCheckout = rows.length > 0 && !hasSoldOutItems

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground">Your cart</h1>

      {rows.length === 0 ? (
        <p className="mt-8 rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Your cart is empty. <Link href="/" className="text-brand-orange underline">Continue shopping</Link>.
        </p>
      ) : (
        <>
          <div className="mt-6 rounded-xl border border-border px-4">
            {rows.map((row) => (
              <CartItemRow key={row.cartItemId} {...row} />
            ))}
          </div>

          {hasSoldOutItems && (
            <p className="mt-3 text-sm text-red-600">
              Remove unavailable items above before checking out.
            </p>
          )}

          <div className="mt-6 flex items-center justify-between border-t border-border pt-4">
            <span className="text-sm text-muted-foreground">Subtotal</span>
            <span className="text-lg font-semibold tabular-nums text-foreground">{formatCurrency(subtotal)}</span>
          </div>

          <Link
            href={canCheckout ? '/checkout' : '#'}
            aria-disabled={!canCheckout}
            className={`mt-4 block w-full rounded-full px-4 py-3 text-center text-sm font-semibold ${
              canCheckout ? 'bg-brand-orange text-white hover:opacity-90' : 'pointer-events-none bg-muted text-muted-foreground'
            }`}
          >
            Proceed to checkout
          </Link>
        </>
      )}
    </main>
  )
}
