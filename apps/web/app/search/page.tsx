import type { Metadata } from "next";
import { getPublishedProductsPage, getCategories, LISTING_PAGE_SIZE } from "@/lib/queries";
import { ProductCard } from "@/components/ProductCard";
import { Pagination } from "@/components/Pagination";

export const metadata: Metadata = {
  title: "Search",
  robots: { index: false }, // query-string search results aren't durable, indexable pages
};

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const { q, page: rawPage } = await searchParams;
  const query = (q || "").trim();
  const currentPage = Math.max(1, Number.parseInt(rawPage ?? "1", 10) || 1);

  const [{ products, total }, templates] = await Promise.all([
    query
      ? getPublishedProductsPage({ search: query, page: currentPage })
      : Promise.resolve({ products: [], total: 0 }),
    getCategories(),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / LISTING_PAGE_SIZE));

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground">
        {query ? `Results for "${query}"` : "Search"}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {query ? `${total} product${total !== 1 ? "s" : ""}` : "Enter a search term above."}
      </p>

      {query && products.length === 0 && (
        <p className="mt-10 rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No products matched your search.
        </p>
      )}

      {products.length > 0 && (
        <>
          <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {products.map((product) => (
              <ProductCard key={product.id} product={product} templates={templates} />
            ))}
          </div>
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            buildHref={(page) => {
              const params = new URLSearchParams();
              params.set("q", query);
              if (page > 1) params.set("page", String(page));
              return `/search?${params.toString()}`;
            }}
          />
        </>
      )}
    </main>
  );
}
