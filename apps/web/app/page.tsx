import Link from "next/link";
import { getPublishedProducts, getCategories } from "@/lib/queries";
import { categoryToSlug } from "@/lib/categories";
import { ProductCard } from "@/components/ProductCard";
import { CategoryTile } from "@/components/CategoryTile";
import { TrustBadges } from "@/components/TrustBadges";
import { ProcessSteps } from "@/components/ProcessSteps";
import { GoogleReviews } from "@/components/GoogleReviews";
import { StoreLocation } from "@/components/StoreLocation";

export const revalidate = 60;

const HERO_CATEGORIES = [
  { code: "LAP", label: "Laptops" },
  { code: "DES", label: "Desktops" },
  { code: "MON", label: "Monitors" },
  { code: "TAB", label: "Tablets" },
  { code: "ACC", label: "Accessories" },
];

function discountPercent(price: number, marketPrice: number | null): number {
  if (!marketPrice || marketPrice <= price) return 0;
  return Math.round(((marketPrice - price) / marketPrice) * 100);
}

export default async function HomePage() {
  const [products, templates] = await Promise.all([
    getPublishedProducts({ limit: 24 }),
    getCategories(),
  ]);

  const bestDeals = [...products]
    .filter((p) => discountPercent(p.web_price, p.market_price) > 0)
    .sort((a, b) => discountPercent(b.web_price, b.market_price) - discountPercent(a.web_price, a.market_price))
    .slice(0, 4);

  const recentlyAdded = products.slice(0, 8);

  return (
    <main>
      <section className="relative overflow-hidden border-b border-border">
        <div
          className="absolute inset-0 -z-10"
          style={{
            background:
              "radial-gradient(60% 90% at 15% 0%, color-mix(in oklab, var(--brand-orange) 12%, transparent), transparent), radial-gradient(50% 80% at 100% 10%, color-mix(in oklab, var(--brand-blue) 14%, transparent), transparent)",
          }}
        />
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
          <p className="animate-fade-up inline-flex items-center rounded-full border border-brand-orange/30 bg-brand-orange/10 px-3 py-1 text-xs font-semibold text-brand-orange-dark">
            Quality-checked · 6-month warranty
          </p>
          <h1 className="animate-fade-up mt-4 max-w-2xl text-4xl font-bold tracking-tight text-foreground sm:text-5xl" style={{ animationDelay: "60ms" }}>
            Great tech, <span className="text-brand-orange">without</span> the new price.
          </h1>
          <p className="animate-fade-up mt-4 max-w-xl text-base text-muted-foreground sm:text-lg" style={{ animationDelay: "120ms" }}>
            Laptops, desktops, monitors and accessories — every unit inspected and warrantied before it reaches you.
          </p>
          <div className="animate-fade-up mt-7 flex flex-wrap gap-2.5" style={{ animationDelay: "180ms" }}>
            {HERO_CATEGORIES.map((c, i) => (
              <Link
                key={c.code}
                href={`/${categoryToSlug(c.code)}`}
                className={
                  i === 0
                    ? "rounded-full bg-brand-orange px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-brand-orange/20 transition-transform hover:-translate-y-0.5 hover:opacity-90"
                    : "rounded-full border border-border bg-card px-5 py-2.5 text-sm font-semibold text-foreground transition-all hover:-translate-y-0.5 hover:border-brand-orange/40 hover:text-brand-orange"
                }
              >
                Shop {c.label}
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-border bg-card">
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
          <TrustBadges />
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        <h2 className="mb-5 font-heading text-lg font-bold text-foreground">Shop by category</h2>
        <div className="stagger grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {HERO_CATEGORIES.map((c) => (
            <CategoryTile key={c.code} href={`/${categoryToSlug(c.code)}`} code={c.code} label={c.label} />
          ))}
        </div>
      </section>

      {bestDeals.length > 0 && (
        <section className="bg-secondary/30">
          <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
            <div className="mb-6 flex items-baseline justify-between">
              <h2 className="font-heading text-xl font-bold text-foreground">Best deals right now</h2>
              <span className="text-sm font-medium text-brand-orange">Biggest markdowns</span>
            </div>
            <div className="stagger grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {bestDeals.map((product) => (
                <ProductCard key={product.id} product={product} templates={templates} />
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-baseline justify-between">
          <h2 className="font-heading text-xl font-bold text-foreground">Recently added</h2>
        </div>

        {recentlyAdded.length === 0 ? (
          <p className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            No products published yet.
          </p>
        ) : (
          <div className="stagger grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {recentlyAdded.map((product) => (
              <ProductCard key={product.id} product={product} templates={templates} />
            ))}
          </div>
        )}
      </section>

      <section className="border-t border-border bg-card">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
          <h2 className="mb-6 font-heading text-xl font-bold text-foreground">How DigitalBluez works</h2>
          <ProcessSteps />
        </div>
      </section>

      <section className="border-t border-border">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
          <h2 className="mb-6 font-heading text-xl font-bold text-foreground">What our customers say</h2>
          <GoogleReviews />
        </div>
      </section>

      <section className="border-t border-border bg-card">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
          <h2 className="mb-6 font-heading text-xl font-bold text-foreground">Visit our store</h2>
          <StoreLocation />
        </div>
      </section>
    </main>
  );
}
