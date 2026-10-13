import type { MetadataRoute } from "next";
import { getSitemapProducts, getCategoryProductCounts, getPublishedBlogPosts } from "@/lib/queries";
import { CATEGORY_SLUGS } from "@/lib/categories";
import { SITE_URL } from "@/lib/site-url";
import { collectionPath, getIndexableCollections } from "@/lib/collections";

// Regenerated at most hourly; product/category pages themselves use a 60s ISR
// window, so the sitemap can lag a new listing by up to an hour.
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [products, categoryCounts, posts, collections] = await Promise.all([
    getSitemapProducts(),
    getCategoryProductCounts(),
    getPublishedBlogPosts(),
    getIndexableCollections(),
  ]);

  const staticEntries: MetadataRoute.Sitemap = [
    { url: SITE_URL, changeFrequency: "daily", priority: 1 },
    { url: `${SITE_URL}/about`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${SITE_URL}/contact`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${SITE_URL}/faq`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${SITE_URL}/warranty`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${SITE_URL}/replacement-policy`, changeFrequency: "monthly", priority: 0.4 },
    { url: `${SITE_URL}/shipping-policy`, changeFrequency: "monthly", priority: 0.4 },
    // The blog index is only worth crawling once it has something on it.
    ...(posts.length > 0 ? [{ url: `${SITE_URL}/blog`, changeFrequency: "weekly" as const, priority: 0.5 }] : []),
  ];

  const blogEntries: MetadataRoute.Sitemap = posts.map((p) => ({
    url: `${SITE_URL}/blog/${p.slug}`,
    lastModified: p.published_at ?? undefined,
    changeFrequency: "monthly",
    priority: 0.4,
  }));

  // Only categories that have a real route (a mapped slug) AND at least one
  // published product. Previously every public_categories row was emitted,
  // which put empty categories and unmapped codes (e.g. /service, a 404) in
  // the sitemap.
  const categoryEntries: MetadataRoute.Sitemap = Object.entries(CATEGORY_SLUGS)
    .filter(([code]) => (categoryCounts[code] ?? 0) > 0)
    .map(([, slug]) => ({
      url: `${SITE_URL}/${slug}`,
      changeFrequency: "daily",
      priority: 0.8,
    }));

  // Only collections that currently pass their indexing gate (enough available
  // stock and enough original text); a thin one stays out of the sitemap.
  const collectionEntries: MetadataRoute.Sitemap = collections.map((c) => ({
    url: `${SITE_URL}${collectionPath(c)}`,
    lastModified: c.updated_at,
    changeFrequency: "daily",
    priority: 0.7,
  }));

  const productEntries: MetadataRoute.Sitemap = products
    .filter((p) => p.web_slug)
    .map((p) => ({
      url: `${SITE_URL}/product/${p.web_slug}`,
      lastModified: p.published_at,
      changeFrequency: "weekly",
      priority: 0.6,
    }));

  return [...staticEntries, ...categoryEntries, ...collectionEntries, ...productEntries, ...blogEntries];
}
