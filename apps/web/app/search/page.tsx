import type { Metadata } from "next";
import { getPublishedProducts, getCategories } from "@/lib/queries";
import { ProductCard } from "@/components/ProductCard";

export const metadata: Metadata = {
  title: "Search",
  robots: { index: false }, // query-string search results aren't durable, indexable pages
};

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const query = (q || "").trim();
  const [products, templates] = await Promise.all([
    query ? getPublishedProducts({ search: query }) : Promise.resolve([]),
    getCategories(),
  ]);

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground">
        {query ? `Results for "${query}"` : "Search"}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {query ? `${products.length} product${products.length !== 1 ? "s" : ""}` : "Enter a search term above."}
      </p>

      {query && products.length === 0 && (
        <p className="mt-10 rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No products matched your search.
        </p>
      )}

      {products.length > 0 && (
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} templates={templates} />
          ))}
        </div>
      )}
    </main>
  );
}
