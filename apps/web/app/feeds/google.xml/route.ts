import { getPublishedProducts, getCategories, getAllProductImages } from "@/lib/queries";
import { productDisplayTitle } from "@/lib/product-title";
import { productImageUrl } from "@/lib/image-url";
import { SITE_URL } from "@/lib/site-url";
import { isRefurbishedMachine, categoryPluralLabel } from "@/lib/seo";
import { getSeoSettings, renderTemplate } from "@/lib/seo-data";
import { formatCurrency } from "@db/shared";

// Google Merchant Center product feed (RSS 2.0 + g: namespace), fetched on a
// schedule by Merchant Center ("Scheduled fetch") -- no API access needed.
//
// What is deliberately NOT in it:
//  - Accessories/components: the feed requires a condition for every item and
//    the ERP does not record whether a cable or UPS is new or used.
//  - Sold-out items: they would be disapproved as out of stock.
//  - Sale/MRP prices and GTIN/MPN: none is verified data (identifier_exists=no).
//  - Shipping and return policy: configure those in the Merchant Center account.
export const revalidate = 3600;

const GOOGLE_CATEGORY: Record<string, string> = {
  LAP: "Electronics > Computers > Laptops",
  DES: "Electronics > Computers > Desktop Computers",
  MON: "Electronics > Video > Computer Monitors",
  TAB: "Electronics > Computers > Tablet Computers",
};

const xml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
// XML 1.0 forbids most control characters; one stray character would make Google reject the whole file.
const clean = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim();

export async function GET() {
  const [products, templates, images, settings] = await Promise.all([
    getPublishedProducts(),
    getCategories(),
    getAllProductImages(),
    getSeoSettings(),
  ]);
  const descTemplate =
    settings.product_description_template ||
    "{title}, quality-checked and backed by warranty. Buy online from DigitalBluez, Greater Noida.";

  const items: string[] = [];
  for (const p of products) {
    if (!p.web_slug || !isRefurbishedMachine(p.category)) continue;
    if (p.availability_bucket === "sold_out") continue;
    if (!(p.web_price > 0)) continue;
    const photos = images[p.id] ?? (p.primary_image_path ? [p.primary_image_path] : []);
    if (photos.length === 0) continue; // an item without an image is rejected anyway

    const title = clean(productDisplayTitle(p, templates)).slice(0, 150);
    const description = clean(
      p.web_description ||
        renderTemplate(descTemplate, { title, brand: p.brand, model: p.model_name, price: formatCurrency(p.web_price) })
    ).slice(0, 5000);

    items.push(`    <item>
      <g:id>${xml(p.full_sku_code)}</g:id>
      <g:title>${xml(title)}</g:title>
      <g:description>${xml(description)}</g:description>
      <g:link>${xml(`${SITE_URL}/product/${p.web_slug}`)}</g:link>
      <g:image_link>${xml(productImageUrl(photos[0]))}</g:image_link>
${photos.slice(1, 11).map((ph) => `      <g:additional_image_link>${xml(productImageUrl(ph))}</g:additional_image_link>`).join("\n")}
      <g:availability>in stock</g:availability>
      <g:price>${p.web_price.toFixed(2)} INR</g:price>
      <g:condition>refurbished</g:condition>
${p.brand ? `      <g:brand>${xml(clean(p.brand))}</g:brand>\n` : ""}      <g:identifier_exists>no</g:identifier_exists>
      <g:google_product_category>${xml(GOOGLE_CATEGORY[p.category])}</g:google_product_category>
      <g:product_type>${xml(categoryPluralLabel(p.category, ""))}</g:product_type>
    </item>`.replace(/\n\n/g, "\n"));
  }

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>DigitalBluez</title>
    <link>${xml(SITE_URL)}</link>
    <description>Quality-checked refurbished laptops, desktops, monitors and tablets.</description>
${items.join("\n")}
  </channel>
</rss>
`;
  return new Response(body, {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=0, s-maxage=3600" },
  });
}
