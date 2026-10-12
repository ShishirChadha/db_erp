import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import Link from "next/link";
import { getPublishedProducts, getPublishedProductsPage, getCategories, LISTING_PAGE_SIZE } from "@/lib/queries";
import { CATEGORY_SLUGS, slugToCategory } from "@/lib/categories";
import { ProductCard } from "@/components/ProductCard";
import { ProductFilters } from "@/components/ProductFilters";
import { ListingToolbar } from "@/components/ListingToolbar";
import { Pagination } from "@/components/Pagination";
import { getFilterFacets, filterProducts, applySort, parseSort, parseFiltersFromSearchParams } from "@/lib/product-filters";
import { productDisplayTitle } from "@/lib/product-title";
import { absoluteUrl } from "@/lib/site-url";
import { getRedirectTarget, withSeoOverride } from "@/lib/seo-data";
import { collectionPath, getIndexableCollections } from "@/lib/collections";
import { categoryHeading, categoryPluralLabel } from "@/lib/seo";

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
  searchParams,
}: {
  params: Promise<{ categorySlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const { categorySlug } = await params;
  const { page } = await searchParams;
  const category = await resolveCategory(categorySlug);
  if (!category) return {};

  const heading = categoryHeading(category.code, category.displayName);
  const rawPage = Array.isArray(page) ? page[0] : page;
  const pageNumber = Math.max(1, Number.parseInt(rawPage ?? "1", 10) || 1);
  const isMachine = heading.startsWith("Refurbished");

  return withSeoOverride({
    // Paginated pages get their own title and a self-referencing canonical, so
    // products that only appear on page 2+ stay discoverable. Sort/filter
    // parameters are still folded into the base canonical.
    title: pageNumber > 1 ? `${heading} — Page ${pageNumber}` : heading,
    description: isMachine
      ? `Browse quality-checked ${heading.toLowerCase()}, tested and backed by warranty. Buy online from DigitalBluez, Greater Noida.`
      : `Browse ${heading.toLowerCase()} from DigitalBluez, Greater Noida. Quality-checked stock, backed by warranty.`,
    alternates: { canonical: pageNumber > 1 ? `/${categorySlug}?page=${pageNumber}` : `/${categorySlug}` },
  }, "category", category.code);
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
  if (!category) {
    // Not a category (e.g. the retired /service) -- the ERP may redirect it.
    const target = await getRedirectTarget(`/${categorySlug}`);
    if (target) permanentRedirect(target);
    notFound();
  }

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

  const sort = parseSort(resolvedSearchParams);

  if (isFilterable) {
    allProducts = await getPublishedProducts({ category: category.code });
    const activeFilters = parseFiltersFromSearchParams(resolvedSearchParams);
    const filtered = activeFilters ? filterProducts(allProducts, activeFilters) : allProducts;
    const sorted = applySort(filtered, sort);
    totalCount = sorted.length;
    const start = (currentPage - 1) * LISTING_PAGE_SIZE;
    products = sorted.slice(start, start + LISTING_PAGE_SIZE);
  } else {
    const rawAvailability = Array.isArray(resolvedSearchParams.availability)
      ? resolvedSearchParams.availability[0]
      : resolvedSearchParams.availability;
    const { products: pageProducts, total } = await getPublishedProductsPage({
      category: category.code,
      page: currentPage,
      sort,
      excludeSoldOut: rawAvailability === "in_stock",
    });
    products = pageProducts;
    totalCount = total;
  }

  // Curated collection pages for this category (only ones currently passing
  // their indexing gate) -- real server-rendered links for crawlers and shoppers.
  const collections = (await getIndexableCollections()).filter((c) => c.category === category.code);
  const facets = isFilterable ? getFilterFacets(allProducts) : null;
  const totalPages = Math.max(1, Math.ceil(totalCount / LISTING_PAGE_SIZE));
  const heading = categoryHeading(category.code, category.displayName);
  const label = categoryPluralLabel(category.code, category.displayName);

  // A page number past the end is a soft 404 (200 + "no products"); return a
  // real 404 instead. Page 1 of an empty category is still a valid page.
  if (currentPage > totalPages) notFound();

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: absoluteUrl("/") },
      { "@type": "ListItem", position: 2, name: label, item: absoluteUrl(`/${categorySlug}`) },
    ],
  };

  const itemListJsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: products.map((product, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: absoluteUrl(`/product/${product.web_slug}`),
      name: productDisplayTitle(product, category.templates),
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
        <span className="text-foreground">{label}</span>
      </nav>
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-5">
        <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          {heading}
        </h1>
        <div className="flex items-center gap-4">
          <p className="text-sm text-muted-foreground">{totalCount} product{totalCount !== 1 ? "s" : ""}</p>
          <ListingToolbar showAvailability={!isFilterable} />
        </div>
      </div>

      {collections.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">Shop by:</span>
          {collections.map((c) => (
            <Link key={c.slug} href={collectionPath(c)} className="rounded-full border border-border px-3 py-1 text-sm hover:border-brand-orange hover:text-brand-orange">
              {c.name}
            </Link>
          ))}
        </div>
      )}

      <div className="mt-6 flex flex-col gap-6 lg:flex-row">
        {facets && <ProductFilters facets={facets} />}

        <div className="flex-1">
          {products.length === 0 ? (
            <p className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              {isFilterable && allProducts.length > 0
                ? "No products match your selected filters — try clearing one or two."
                : `No ${label.toLowerCase()} available right now — check back soon.`}
            </p>
          ) : (
            <>
              <div className="stagger grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4">
                {products.map((product, index) => (
                  <ProductCard key={product.id} product={product} templates={category.templates} priority={index < 4} />
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
