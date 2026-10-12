import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import Link from "next/link";
import { getCategories } from "@/lib/queries";
import { categoryToSlug } from "@/lib/categories";
import { absoluteUrl } from "@/lib/site-url";
import { productDisplayTitle } from "@/lib/product-title";
import { categoryPluralLabel } from "@/lib/seo";
import { getRedirectTarget } from "@/lib/seo-data";
import { collectionPath, getCollection, getIndexableCollections } from "@/lib/collections";
import { MarkdownBody } from "@/lib/markdown";
import { ProductCard } from "@/components/ProductCard";

export const revalidate = 60;

// Same reasoning as the category page: an (empty) params list is what makes this
// dynamic segment ISR-cacheable instead of rendered on every request.
export async function generateStaticParams() {
  return [];
}

const MAX_PRODUCTS = 48;

type Params = Promise<{ categorySlug: string; collection: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { categorySlug, collection: slug } = await params;
  const data = await getCollection(categorySlug, slug);
  if (!data) return {};
  const { collection: c, state } = data;
  const heading = c.h1 || `Refurbished ${c.name} ${categoryPluralLabel(data.category, "")}`.trim();
  const description =
    c.meta_description ||
    `Browse ${state.available.length} quality-checked refurbished ${c.name} ${categoryPluralLabel(data.category, "").toLowerCase()} from DigitalBluez, Greater Noida. Backed by warranty.`;
  const title = c.meta_title || heading;
  return {
    title,
    description,
    alternates: { canonical: collectionPath(c) },
    // A thin page (not enough stock or original text yet) stays reachable for
    // visitors but out of search results until it qualifies.
    robots: state.indexable ? { index: true, follow: true } : { index: false, follow: true },
    openGraph: { title, description, siteName: "DigitalBluez", type: "website", locale: "en_IN", url: collectionPath(c) },
  };
}

export default async function CollectionPage({ params }: { params: Params }) {
  const { categorySlug, collection: slug } = await params;
  const data = await getCollection(categorySlug, slug);

  if (!data) {
    const target = await getRedirectTarget(`/${categorySlug}/${slug}`);
    if (target) permanentRedirect(target);
    notFound();
  }

  const { collection: c, category, state } = data;
  // Nothing at all matches (not even sold-out items): a real 404, not an empty page.
  if (state.matching.length === 0) notFound();

  const templates = await getCategories();
  const label = categoryPluralLabel(category, templates.find((t) => t.category === category)?.display_name ?? "");
  const heading = c.h1 || `Refurbished ${c.name} ${label}`;
  const catSlug = categoryToSlug(category);
  const shown = state.available.slice(0, MAX_PRODUCTS);

  const siblings = (await getIndexableCollections()).filter((x) => x.category === category && x.slug !== c.slug);

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: absoluteUrl("/") },
      { "@type": "ListItem", position: 2, name: label, item: absoluteUrl(`/${catSlug}`) },
      { "@type": "ListItem", position: 3, name: c.name, item: absoluteUrl(collectionPath(c)) },
    ],
  };
  const itemListJsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: shown.map((p, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: absoluteUrl(`/product/${p.web_slug}`),
      name: productDisplayTitle(p, templates),
    })),
  };

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }} />
      {shown.length > 0 && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListJsonLd) }} />
      )}
      <nav className="mb-4 text-sm text-muted-foreground">
        <Link href="/" className="hover:text-brand-orange">Home</Link>
        <span className="mx-1.5">/</span>
        <Link href={`/${catSlug}`} className="hover:text-brand-orange">{label}</Link>
        <span className="mx-1.5">/</span>
        <span className="text-foreground">{c.name}</span>
      </nav>

      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-5">
        <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground sm:text-3xl">{heading}</h1>
        <p className="text-sm text-muted-foreground">{state.available.length} available</p>
      </div>

      {c.intro_md && <MarkdownBody source={c.intro_md} />}

      <div className="mt-8">
        {shown.length === 0 ? (
          <p className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            Everything in this range has just sold. <Link href={`/${catSlug}`} className="text-brand-orange underline">Browse all {label.toLowerCase()}</Link>.
          </p>
        ) : (
          <div className="stagger grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {shown.map((p, i) => (
              <ProductCard key={p.id} product={p} templates={templates} priority={i < 4} />
            ))}
          </div>
        )}
        {state.available.length > MAX_PRODUCTS && (
          <p className="mt-6 text-sm text-muted-foreground">
            Showing the newest {MAX_PRODUCTS}. <Link href={`/${catSlug}`} className="text-brand-orange underline">See all {label.toLowerCase()}</Link> to filter further.
          </p>
        )}
      </div>

      {c.faq.length > 0 && (
        <section className="mt-12">
          <h2 className="mb-3 font-heading text-lg font-bold text-foreground">Common questions</h2>
          <div className="divide-y divide-border rounded-lg border border-border">
            {c.faq.map((f) => (
              <details key={f.q} className="group p-4">
                <summary className="cursor-pointer text-sm font-medium text-foreground">{f.q}</summary>
                <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">{f.a}</p>
              </details>
            ))}
          </div>
        </section>
      )}

      {siblings.length > 0 && (
        <section className="mt-12">
          <h2 className="mb-3 font-heading text-lg font-bold text-foreground">More ways to shop {label.toLowerCase()}</h2>
          <div className="flex flex-wrap gap-2">
            {siblings.map((s) => (
              <Link key={s.slug} href={collectionPath(s)} className="rounded-full border border-border px-4 py-1.5 text-sm hover:border-brand-orange hover:text-brand-orange">
                {s.name}
              </Link>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
