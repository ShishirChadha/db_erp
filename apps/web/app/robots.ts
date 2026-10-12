import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site-url";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // /search is also noindexed, but a robots.txt block means crawlers never
      // see that tag -- kept disallowed to avoid crawl waste on result pages.
      // Cart/checkout/account/order pages are private and carry a noindex tag
      // too (they are deliberately NOT disallowed here so the tag is seen).
      disallow: ["/search", "/api/"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
