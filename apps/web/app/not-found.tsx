import type { Metadata } from "next";
import Link from "next/link";
import { getCategoryProductCounts } from "@/lib/queries";
import { CATEGORY_SLUGS } from "@/lib/categories";
import { categoryPluralLabel } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Page not found",
};

const LINK_ORDER = ["LAP", "DES", "MON", "TAB", "ACC", "ADP"];

export default async function NotFound() {
  const counts = await getCategoryProductCounts();
  const categories = LINK_ORDER.filter((code) => code in CATEGORY_SLUGS && (counts[code] ?? 0) > 0);

  return (
    <main className="mx-auto max-w-2xl px-4 py-20 text-center sm:px-6">
      <p className="text-sm font-semibold text-brand-orange">404</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight text-foreground">We can&apos;t find that page</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        The link may be old, or the product may have been sold. Try a search, or browse what&apos;s in stock now.
      </p>

      <form action="/search" method="get" className="mx-auto mt-6 flex max-w-md gap-2">
        <input
          type="search"
          name="q"
          placeholder="Search laptops, desktops, accessories…"
          aria-label="Search products"
          className="h-10 flex-1 rounded-md border border-border bg-background px-3 text-sm"
        />
        <button type="submit" className="h-10 rounded-md bg-foreground px-4 text-sm font-medium text-background hover:opacity-90">
          Search
        </button>
      </form>

      <div className="mt-8 flex flex-wrap justify-center gap-2">
        <Link href="/" className="rounded-full border border-border px-4 py-1.5 text-sm hover:border-brand-orange hover:text-brand-orange">
          Home
        </Link>
        {categories.map((code) => (
          <Link
            key={code}
            href={`/${CATEGORY_SLUGS[code]}`}
            className="rounded-full border border-border px-4 py-1.5 text-sm hover:border-brand-orange hover:text-brand-orange"
          >
            {categoryPluralLabel(code, code)}
          </Link>
        ))}
      </div>
    </main>
  );
}
