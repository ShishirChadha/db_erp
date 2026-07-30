import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getPublishedProducts, getCategories } from "@/lib/queries";
import { slugToCategory } from "@/lib/categories";
import { ProductCard } from "@/components/ProductCard";

export const revalidate = 60;

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
}: {
  params: Promise<{ categorySlug: string }>;
}) {
  const { categorySlug } = await params;
  const category = await resolveCategory(categorySlug);
  if (!category) notFound();

  const products = await getPublishedProducts({ category: category.code });

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "/" },
      { "@type": "ListItem", position: 2, name: `${category.displayName}s`, item: `/${categorySlug}` },
    ],
  };

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
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

      {products.length === 0 ? (
        <p className="mt-10 rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No {category.displayName.toLowerCase()}s published yet — check back soon.
        </p>
      ) : (
        <div className="stagger mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} templates={category.templates} />
          ))}
        </div>
      )}
    </main>
  );
}
