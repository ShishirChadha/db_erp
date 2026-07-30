import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@db/db/server'
import { getCustomerSession } from '@/lib/customer-session'
import { getCategories, type PublicProduct } from '@/lib/queries'
import { ProductCard } from '@/components/ProductCard'

export const dynamic = 'force-dynamic'

export default async function WishlistPage() {
  const session = await getCustomerSession()
  if (!session) redirect('/login?next=/account/wishlist')

  const supabase = await createServerSupabaseClient()
  const [{ data: wishlist }, templates] = await Promise.all([
    supabase.from('wishlist_items').select('sku_id').eq('customer_id', session.id),
    getCategories(),
  ])

  const skuIds = (wishlist ?? []).map((w) => w.sku_id)
  let products: PublicProduct[] = []
  if (skuIds.length > 0) {
    const { data } = await supabase
      .from('public_products')
      .select(
        'id, web_slug, full_sku_code, category, item_type, brand, model_name, specifications, web_title, web_description, web_highlights, web_condition_grade, web_price, market_price, hsn_code, published_at, availability_bucket, primary_image_path'
      )
      .in('id', skuIds)
    products = (data ?? []) as unknown as PublicProduct[]
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground">My Wishlist</h1>

      {products.length === 0 ? (
        <p className="mt-8 text-sm text-muted-foreground">
          Nothing saved yet — tap the heart icon on any product to save it here.
        </p>
      ) : (
        <div className="stagger mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} templates={templates} />
          ))}
        </div>
      )}
    </main>
  )
}
