import Image from 'next/image'
import Link from 'next/link'
import { buildConfigSummary, type ConfigSummaryTemplate } from '@db/shared'
import type { PublicProduct } from '@/lib/queries'
import { productImageUrl } from '@/lib/image-url'
import { PriceTag } from './PriceTag'
import { AvailabilityBadge } from './AvailabilityBadge'
import { ConditionBadge } from './ConditionBadge'
import { WishlistButton } from './WishlistButton'

export function ProductCard({
  product,
  templates,
}: {
  product: PublicProduct
  templates: ConfigSummaryTemplate[]
}) {
  const title =
    product.web_title ||
    buildConfigSummary(product.category, product.specifications, templates) ||
    [product.brand, product.model_name].filter(Boolean).join(' ')

  const hasDiscount = !!product.market_price && product.market_price > product.web_price
  const percentOff = hasDiscount
    ? Math.round(((product.market_price! - product.web_price) / product.market_price!) * 100)
    : 0

  return (
    <Link
      href={`/product/${product.web_slug}`}
      className="group flex flex-col overflow-hidden rounded-xl border border-border bg-card transition-all hover:-translate-y-0.5 hover:border-brand-orange/30 hover:shadow-lg hover:shadow-black/5"
    >
      <div className="relative aspect-square w-full bg-muted">
        {product.primary_image_path ? (
          <Image
            src={productImageUrl(product.primary_image_path)}
            alt={title}
            fill
            sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
            className="object-cover transition-transform duration-300 group-hover:scale-[1.04]"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No image</div>
        )}
        {hasDiscount && (
          <span className="absolute left-2 top-2 rounded-full bg-brand-orange px-2 py-0.5 text-xs font-bold text-white shadow-sm">
            {percentOff}% off
          </span>
        )}
        {product.web_condition_grade && (
          <span className="absolute right-2 top-2">
            <ConditionBadge grade={product.web_condition_grade} />
          </span>
        )}
        <WishlistButton skuId={product.id} className="absolute bottom-2 right-2" />
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3.5">
        <p className="line-clamp-2 text-sm font-medium text-foreground">{title}</p>
        <div className="mt-auto flex items-center justify-between gap-2">
          <PriceTag price={product.web_price} marketPrice={product.market_price} />
        </div>
        <AvailabilityBadge bucket={product.availability_bucket} />
      </div>
    </Link>
  )
}
