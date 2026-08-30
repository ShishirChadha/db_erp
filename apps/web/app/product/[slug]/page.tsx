import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { isSerializedCategory } from "@db/shared";
import {
  getProductBySlug,
  getProductImages,
  getCategories,
  getProductUnits,
  getAssetTestReport,
  getUpgradeOptions,
  getPublishedProducts,
  getSiblingConfigurations,
  getCrossSellCategories,
} from "@/lib/queries";
import { productImageUrl } from "@/lib/image-url";
import { categoryToSlug } from "@/lib/categories";
import { ProductGallery } from "@/components/ProductGallery";
import { PriceTag } from "@/components/PriceTag";
import { AvailabilityBadge } from "@/components/AvailabilityBadge";
import { ConditionBadge } from "@/components/ConditionBadge";
import { PurchaseUpgradeArea } from "@/components/PurchaseUpgradeArea";
import { TrustBadges } from "@/components/TrustBadges";
import { GoogleRatingBadge } from "@/components/GoogleReviews";
import { ProductUnitCard } from "@/components/ProductUnitCard";
import { SiblingConfigs } from "@/components/SiblingConfigs";
import { BuybackBadge } from "@/components/BuybackBadge";
import { NeedHelpCTA } from "@/components/NeedHelpCTA";
import { ShareButtons } from "@/components/ShareButtons";
import { WishlistButton } from "@/components/WishlistButton";
import { ProductGrid } from "@/components/ProductGrid";
import { StickyBuyBar } from "@/components/StickyBuyBar";

export const revalidate = 60;

// Enumerating known slugs (rather than relying on dynamicParams on-demand
// generation) is what makes this route ISR-cacheable at all -- without at
// least an empty array returned from generateStaticParams, Next.js renders
// dynamic segments fully per-request regardless of `revalidate`. The catalog
// is small enough to prerender every published product at build time.
export async function generateStaticParams() {
  const products = await getPublishedProducts({});
  return products.filter((p) => p.web_slug).map((p) => ({ slug: p.web_slug as string }));
}

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3001";

const SCHEMA_AVAILABILITY: Record<string, string> = {
  in_stock: "https://schema.org/InStock",
  low_stock: "https://schema.org/LimitedAvailability",
  sold_out: "https://schema.org/OutOfStock",
};

function specRows(specifications: Record<string, unknown> | null, fieldSchema: any) {
  const specs = specifications || {};
  const fields = (typeof fieldSchema === "string" ? JSON.parse(fieldSchema) : fieldSchema)?.fields || [];
  return fields
    .filter((f: any) => f.name !== "brand" && f.name !== "model")
    .map((f: any) => ({ label: f.label || f.name, value: specs[f.name] }))
    .filter((row: any) => row.value !== undefined && row.value !== null && row.value !== "");
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) return {};

  const title = product.web_title || [product.brand, product.model_name].filter(Boolean).join(" ");
  const description =
    product.web_description || `Refurbished ${title}, quality-checked and backed by warranty.`;
  const ogImage = product.primary_image_path ? [productImageUrl(product.primary_image_path)] : undefined;

  return {
    title,
    description,
    alternates: { canonical: `/product/${slug}` },
    openGraph: { title, description, images: ogImage },
  };
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) notFound();

  const [images, templates, units, related, crossSellCategories, siblings] = await Promise.all([
    getProductImages(product.id),
    getCategories(),
    isSerializedCategory(product.category) ? getProductUnits(product.id) : Promise.resolve([]),
    getPublishedProducts({ category: product.category, excludeId: product.id, limit: 8 }),
    getCrossSellCategories(product.category),
    product.brand && product.model_name
      ? getSiblingConfigurations({
          category: product.category,
          brand: product.brand,
          modelName: product.model_name,
          excludeId: product.id,
        })
      : Promise.resolve([]),
  ]);

  // Owner-configured category->category mapping (Settings -> Website Admin ->
  // Cross-sell), replacing a hardcoded category='ACC' pull.
  const accessories = crossSellCategories.length > 0
    ? await getPublishedProducts({ category: crossSellCategories, excludeId: product.id, limit: 4 })
    : [];

  const template = templates.find((t) => t.category === product.category);
  const rows = specRows(product.specifications, template?.field_schema);
  const title = product.web_title || [product.brand, product.model_name].filter(Boolean).join(" ");
  const categorySlug = categoryToSlug(product.category);

  // Only ever show "this exact unit" when there's exactly one sellable,
  // graded unit -- a SKU can carry quantity 1-2, and showing a single serial
  // number when 2 units are both available would be misleading.
  const singleUnit = units.length === 1 && units[0].serial_number ? units[0] : null;
  const testReport = singleUnit ? await getAssetTestReport(product.id, singleUnit.serial_number!) : [];
  const upgradeOptions = isSerializedCategory(product.category)
    ? await getUpgradeOptions({
        category: product.category,
        currentRam: (product.specifications as any)?.ram ?? null,
        currentSsd: (product.specifications as any)?.ssd ?? null,
        currentWarrantyMonths: singleUnit?.warranty_duration_months ?? null,
      })
    : [];

  const relatedSameBrand = related.filter((p) => p.brand === product.brand);
  const relatedOthers = related.filter((p) => p.brand !== product.brand);
  const relatedProducts = [...relatedSameBrand, ...relatedOthers].slice(0, 4);

  const productJsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: title,
    description: product.web_description || undefined,
    sku: product.full_sku_code,
    brand: product.brand ? { "@type": "Brand", name: product.brand } : undefined,
    image: product.primary_image_path ? productImageUrl(product.primary_image_path) : undefined,
    itemCondition: "https://schema.org/RefurbishedCondition",
    additionalProperty: rows.map((row: { label: string; value: unknown }) => ({
      "@type": "PropertyValue",
      name: row.label,
      value: String(row.value),
    })),
    offers: {
      "@type": "Offer",
      priceCurrency: "INR",
      price: product.web_price,
      availability: SCHEMA_AVAILABILITY[product.availability_bucket],
      url: `/product/${slug}`,
    },
  };

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "/" },
      { "@type": "ListItem", position: 2, name: template?.display_name || product.category, item: `/${categorySlug}` },
      { "@type": "ListItem", position: 3, name: title, item: `/product/${slug}` },
    ],
  };

  return (
    <>
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        <script
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: JSON.stringify(productJsonLd) }}
        />
        <script
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
        />

        <nav className="mb-4 text-sm text-muted-foreground">
          <Link href="/" className="hover:text-brand-orange">Home</Link>
          <span className="mx-1.5">/</span>
          <Link href={`/${categorySlug}`} className="hover:text-brand-orange">{template?.display_name || product.category}</Link>
          <span className="mx-1.5">/</span>
          <span className="text-foreground">{title}</span>
        </nav>

        <div className="grid grid-cols-1 gap-10 lg:grid-cols-2">
          <ProductGallery images={images} alt={title} />

          <div>
            <div className="flex items-start justify-between gap-3">
              <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground sm:text-3xl">{title}</h1>
              <div className="flex shrink-0 items-center gap-2">
                <WishlistButton skuId={product.id} />
                <ShareButtons url={`${SITE_URL}/product/${slug}`} title={title} />
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <AvailabilityBadge bucket={product.availability_bucket} />
              {product.web_condition_grade && <ConditionBadge grade={product.web_condition_grade} />}
            </div>

            <div className="mt-5">
              <PriceTag price={product.web_price} marketPrice={product.market_price} size="lg" />
            </div>

            {siblings.length > 0 && (
              <div className="mt-5">
                <SiblingConfigs current={product} siblings={siblings} templates={templates} />
              </div>
            )}

            {product.web_highlights && product.web_highlights.length > 0 && (
              <ul className="mt-5 space-y-1.5 text-sm text-foreground">
                {product.web_highlights.map((h, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-brand-blue">✓</span>
                    {h}
                  </li>
                ))}
              </ul>
            )}

            {singleUnit && (
              <div className="mt-5">
                <ProductUnitCard unit={singleUnit} testReport={testReport} />
              </div>
            )}

            {isSerializedCategory(product.category) && (
              <div className="mt-5">
                <BuybackBadge price={product.web_price} />
              </div>
            )}

            <div className="mt-6">
              <PurchaseUpgradeArea
                skuId={product.id}
                basePrice={product.web_price}
                disabled={product.availability_bucket === "sold_out"}
                options={upgradeOptions}
              />
            </div>

            <div className="mt-4">
              <NeedHelpCTA />
            </div>

            <div className="mt-6 rounded-xl border border-border bg-secondary/40 p-4">
              <TrustBadges compact />
              <div className="mt-4 border-t border-border/60 pt-4">
                <GoogleRatingBadge />
              </div>
            </div>

            {rows.length > 0 && (
              <div className="mt-8">
                <h2 className="mb-3 text-sm font-bold text-foreground">Specifications</h2>
                <div className="grid grid-cols-2 gap-2">
                  {rows.map((row: any) => (
                    <div key={row.label} className="rounded-lg border border-border bg-secondary/30 px-3 py-2.5">
                      <dt className="text-xs text-muted-foreground">{row.label}</dt>
                      <dd className="mt-0.5 text-sm font-semibold text-foreground">{String(row.value)}</dd>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {product.web_description && (
              <div className="mt-8">
                <h2 className="mb-2 text-sm font-bold text-foreground">Description</h2>
                <p className="whitespace-pre-line text-sm text-muted-foreground">{product.web_description}</p>
              </div>
            )}
          </div>
        </div>

        <ProductGrid title="Complete your setup" products={accessories} templates={templates} />
        <ProductGrid title="You may also like" products={relatedProducts} templates={templates} />
      </main>

      <StickyBuyBar
        price={product.web_price}
        marketPrice={product.market_price}
        skuId={product.id}
        disabled={product.availability_bucket === "sold_out"}
      />
    </>
  );
}
