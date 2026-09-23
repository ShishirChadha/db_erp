import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getPublishedProducts, getPublishedProductsPage, getCategories, LISTING_PAGE_SIZE } from "@/lib/queries";
import { CATEGORY_SLUGS, slugToCategory } from "@/lib/categories";
import { ProductCard } from "@/components/ProductCard";
import { ProductFilters } from "@/components/ProductFilters";
import { Pagination } from "@/components/Pagination";
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

  const resolvedSearchParams = await searchParams;
  const rawPage = Array.isArray(resolvedSearchParams.page) ? resolvedSearchParams.page[0] : resolvedSearchParams.page;
  const currentPage = Math.max(1, Number.parseInt(rawPage ?? "1", 10) || 1);

  const isFilterable = FILTERABLE_SLUGS.has(categorySlug);

  // Filterable categories (Laptops/Desktops) need the full category set in
  // memory regardless -- getFilterFacets()/filterProducts() compute facet
  // counts and apply filters client-side over the whole set (see
  // lib/product-filters.ts), so pagination there slices the already-filtered
  // in-memory array rather than paginating at the DB query level. Every other
  // category page has no facets to compute, so it fetches only its page of
  // rows straight from the DB via getPublishedProductsPage().
  let allProducts: Awaited<ReturnType<typeof getPublishedProducts>> = [];
  let products: Awaited<ReturnType<typeof getPublishedProducts>>;
  let totalCount: number;

  if (isFilterable) {
    allProducts = await getPublishedProducts({ category: category.code });
    const activeFilters = parseFiltersFromSearchParams(resolvedSearchParams);
    const filtered = activeFilters ? filterProducts(allProducts, activeFilters) : allProducts;
    totalCount = filtered.length;
    const start = (currentPage - 1) * LISTING_PAGE_SIZE;
    products = filtered.slice(start, start + LISTING_PAGE_SIZE);
  } else {
    const { products: pageProducts, total } = await getPublishedProductsPage({
      category: category.code,
      page: currentPage,
    });
    products = pageProducts;
    totalCount = total;
  }

  const facets = isFilterable ? getFilterFacets(allProducts) : null;
  const totalPages = Math.max(1, Math.ceil(totalCount / LISTING_PAGE_SIZE));

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
        <p className="text-sm text-muted-foreground">{totalCount} product{totalCount !== 1 ? "s" : ""}</p>
      </div>

      <div className="mt-6 flex flex-col gap-6 lg:flex-row">
        {facets && <ProductFilters facets={facets} />}

        <div className="flex-1">
          {products.length === 0 ? (
            <p className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              {isFilterable && allProducts.length > 0
                ? "No products match your selected filters — try clearing one or two."
                : `No ${category.displayName.toLowerCase()}s published yet — check back soon.`}
            </p>
          ) : (
            <>
              <div className="stagger grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4">
                {products.map((product) => (
                  <ProductCard key={product.id} product={product} templates={category.templates} />
                ))}
              </div>
              <Pagination
                currentPage={currentPage}
                totalPages={totalPages}
                buildHref={(page) => {
                  const params = new URLSearchParams(
                    Object.entries(resolvedSearchParams).flatMap(([key, value]) => {
                      if (value === undefined) return [];
                      return Array.isArray(value) ? value.map((v) => [key, v] as [string, string]) : [[key, value] as [string, string]];
                    })
                  );
                  if (page <= 1) params.delete("page"); else params.set("page", String(page));
                  const qs = params.toString();
                  return `/${categorySlug}${qs ? `?${qs}` : ""}`;
                }}
              />
            </>
          )}
        </div>
      </div>
    </main>
  );
}
