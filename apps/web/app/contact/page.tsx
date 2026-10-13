import type { Metadata } from "next";
import { withSeoOverride } from "@/lib/seo-data";
import { StoreLocation } from "@/components/StoreLocation";
import {
  BUSINESS_EMAIL,
  BUSINESS_HOURS_TEXT,
  BUSINESS_NAME,
  BUSINESS_OPENING_HOURS_SPEC,
  BUSINESS_PHONE_TEL,
  BUSINESS_POSTAL_ADDRESS,
  SOCIAL_LINKS,
  WHATSAPP_NUMBER,
} from "@/lib/business-info";
import { SITE_URL } from "@/lib/site-url";

// Metadata can be overridden from the ERP (Settings -> Website SEO), so this
// page is re-rendered periodically instead of frozen at build time.
export const revalidate = 60;

const baseMetadata: Metadata = {
  title: "Contact Us",
  description: "Get in touch with DigitalBluez — Greater Noida, Uttar Pradesh.",
  alternates: { canonical: "/contact" },
};


export async function generateMetadata(): Promise<Metadata> {
  return withSeoOverride(baseMetadata, "static", "/contact");
}

// Only facts the owner has confirmed (hours confirmed 2026-10-13). Deliberately
// NOT included until confirmed: geo coordinates, price range. No
// rating either -- self-published ratings are not eligible for rich results.
const storeJsonLd = {
  "@context": "https://schema.org",
  "@type": "ComputerStore",
  "@id": `${SITE_URL}/contact#store`,
  name: BUSINESS_NAME,
  url: SITE_URL,
  logo: `${SITE_URL}/dbz-logo.png`,
  image: `${SITE_URL}/dbz-logo.png`,
  telephone: BUSINESS_PHONE_TEL,
  email: BUSINESS_EMAIL,
  address: BUSINESS_POSTAL_ADDRESS,
  openingHoursSpecification: BUSINESS_OPENING_HOURS_SPEC,
  sameAs: [SOCIAL_LINKS.instagram, SOCIAL_LINKS.facebook, SOCIAL_LINKS.linkedin],
};

export default function ContactPage() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(storeJsonLd) }} />
      <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Contact us</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Visit our store in Tech Zone IV, Greater Noida (Greater Noida West) — opposite D-Mart — or message us on WhatsApp.
      </p>

      <div className="mt-8">
        <StoreLocation />
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2">
        <div>
          <p className="text-sm font-semibold text-foreground">Email</p>
          <a href={`mailto:${BUSINESS_EMAIL}`} className="mt-1 block text-sm text-brand-orange hover:underline">
            {BUSINESS_EMAIL}
          </a>
        </div>
        <div>
          <p className="text-sm font-semibold text-foreground">Hours</p>
          <p className="mt-1 text-sm text-muted-foreground">{BUSINESS_HOURS_TEXT}</p>
        </div>
      </div>

      <div className="mt-8 rounded-xl border border-brand-orange/20 bg-brand-orange/5 p-4">
        <p className="text-sm font-semibold text-foreground">Bulk &amp; business orders</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Buying for your office or team? WhatsApp us for bulk pricing and IT support.
        </p>
        <a
          href={`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent("Hi, I'd like to enquire about a bulk/business order.")}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex rounded-full bg-brand-orange px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
        >
          Chat on WhatsApp
        </a>
      </div>
    </main>
  );
}
