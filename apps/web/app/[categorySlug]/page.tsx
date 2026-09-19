import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getPublishedProducts, getCategories } from "@/lib/queries";
import { CATEGORY_SLUGS, slugToCategory } from "@/lib/categories";
import { ProductCard } from "@/components/ProductCard";
import { ProductFilters } from "@/components/ProductFilters";
import { getFilterFacets, filterProducts, parseFiltersFromSearchParams } from "@/lib/product-filters";

export const revalidate = 60;

// Filters only ship on these two listing pages for now (see plan) -- Laptop
// and Desktop are the two categories with rich enough specs (CPU/RAM/Storage/
// GPU/OS) to make faceted filtering worthwhile; every other category page
// stays a plain grid.
const FILTERABLE_SLUGS = new Set(["laptops", "desktops"]);

// A fixed, small set of category codes -- enumerating them here (rather than
// relying on dynamicParams on-demand generation) is what makes this route
// ISR-cacheable at all: without at least an empty array returned from
// generateStaticParams, Next.js renders dynamic segments fully per-request
// regardless of `revalidate`.
export async function generateStaticParams() {
  return Object.values(CATEGORY_SLUGS).map((slug) => ({ categorySlug: slug }));
}

async function resolveCategory(categorySlug: string) {
  const code = slugToCategory(categorySlug);
  if (!code) return null;
  const templates = await getCategories();
  const template = templates.find((t) => t.category === code);
  if (!template) return null;
  return { code, displayName: template.display_name, templates };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ categorySlug: string }>;
}): Promise<Metadata> {
  const { categorySlug } = await params;
  const category = await resolveCategory(categorySlug);
  if (!category) return {};

  return {
    title: `Refurbished ${category.displayName}s`,
    description: `Browse quality-checked refurbished ${category.displayName.toLowerCase()}s, backed by warranty.`,
    alternates: { canonical: `/${categorySlug}` },
  };
}

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ categorySlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { categorySlug } = await params;
  const category = await resolveCategory(categorySlug);
  if (!category) notFound();

  const allProducts = await getPublishedProducts({ category: category.code });

  const isFilterable = FILTERABLE_SLUGS.has(categorySlug);
  const facets = isFilterable ? getFilterFacets(allProducts) : null;
  const activeFilters = isFilterable ? parseFiltersFromSearchParams(await searchParams) : null;
  const products = activeFilters ? filterProducts(allProducts, activeFilters) : allProducts;

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "/" },
      { "@type": "ListItem", position: 2, name: `${category.displayName}s`, item: `/${categorySlug}` },
    ],
  };

  const itemListJsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: products.map((product, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: `/product/${product.web_slug}`,
      name: product.web_title || [product.brand, product.model_name].filter(Boolean).join(" "),
    })),
  };

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
      {products.length > 0 && (
        <script
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListJsonLd) }}
        />
      )}
      <nav className="mb-4 text-sm text-muted-foreground">
        <Link href="/" className="hover:text-brand-orange">Home</Link>
        <span className="mx-1.5">/</span>
        <span className="text-foreground">{category.displayName}s</span>
      </nav>
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-5">
        <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          Refurbished {category.displayName}s
        </h1>
        <p className="text-sm text-muted-foreground">{products.length} product{products.length !== 1 ? "s" : ""}</p>
      </div>

      <div className="mt-6 flex flex-col gap-6 lg:flex-row">
        {facets && <ProductFilters facets={facets} />}

        <div className="flex-1">
          {products.length === 0 ? (
            <p className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              {allProducts.length === 0
                ? `No ${category.displayName.toLowerCase()}s published yet — check back soon.`
                : "No products match your selected filters — try clearing one or two."}
            </p>
          ) : (
            <div className="stagger grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4">
              {products.map((product) => (
                <ProductCard key={product.id} product={product} templates={category.templates} />
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
