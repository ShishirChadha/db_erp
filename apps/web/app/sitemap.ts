import type { MetadataRoute } from "next";
import { getPublishedProducts, getCategories, getPublishedBlogPosts } from "@/lib/queries";
import { categoryToSlug } from "@/lib/categories";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3001";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [products, categories, posts] = await Promise.all([
    getPublishedProducts(),
    getCategories(),
    getPublishedBlogPosts(),
  ]);

  const staticEntries: MetadataRoute.Sitemap = [
    { url: SITE_URL, changeFrequency: "daily", priority: 1 },
    { url: `${SITE_URL}/about`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${SITE_URL}/contact`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${SITE_URL}/blog`, changeFrequency: "weekly", priority: 0.5 },
  ];

  const blogEntries: MetadataRoute.Sitemap = posts.map((p) => ({
    url: `${SITE_URL}/blog/${p.slug}`,
    lastModified: p.published_at ?? undefined,
    changeFrequency: "monthly",
    priority: 0.4,
  }));

  const categoryEntries: MetadataRoute.Sitemap = categories.map((c) => ({
    url: `${SITE_URL}/${categoryToSlug(c.category)}`,
    changeFrequency: "daily",
    priority: 0.8,
  }));

  const productEntries: MetadataRoute.Sitemap = products
    .filter((p) => p.web_slug)
    .map((p) => ({
      url: `${SITE_URL}/product/${p.web_slug}`,
      lastModified: p.published_at,
      changeFrequency: "weekly",
      priority: 0.6,
    }));

  return [...staticEntries, ...categoryEntries, ...productEntries, ...blogEntries];
}
