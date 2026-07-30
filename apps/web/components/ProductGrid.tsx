import { ProductCard } from './ProductCard'
import type { PublicProduct } from '@/lib/queries'
import type { ConfigSummaryTemplate } from '@db/shared'

// Shared grid for the product page's "You may also like" / "Complete your
// setup" sections. Deliberately renders nothing (no empty-state message) when
// there are no candidates -- unlike category/search pages, an empty
// recommendation rail on a product page isn't itself meaningful to a shopper.
export function ProductGrid({
  title,
  products,
  templates,
}: {
  title: string
  products: PublicProduct[]
  templates: ConfigSummaryTemplate[]
}) {
  if (products.length === 0) return null

  return (
    <section className="mt-12">
      <h2 className="mb-5 font-heading text-lg font-bold text-foreground">{title}</h2>
      <div className="stagger grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {products.map((product) => (
          <ProductCard key={product.id} product={product} templates={templates} />
        ))}
      </div>
    </section>
  )
}
