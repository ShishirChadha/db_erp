import type { Metadata } from "next";
import { withSeoOverride } from "@/lib/seo-data";
import { StoreLocation } from "@/components/StoreLocation";
import { getSiteProfile, whatsappLink } from "@/lib/site-profile";
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

export default async function ContactPage() {
  const profile = await getSiteProfile();

  // Only facts the owner has confirmed in Website Admin -> Company & About.
  // Deliberately NOT included: geo coordinates, price range, and any rating
  // (self-published ratings are not eligible for rich results).
  const storeJsonLd = {
    "@context": "https://schema.org",
    "@type": "ComputerStore",
    "@id": `${SITE_URL}/contact#store`,
    name: profile.businessName,
    ...(profile.legalName ? { legalName: profile.legalName } : {}),
    url: SITE_URL,
    logo: `${SITE_URL}/dbz-logo.png`,
    image: `${SITE_URL}/dbz-logo.png`,
    telephone: profile.phoneTel,
    email: profile.email,
    address: profile.postalAddress,
    ...(profile.openingHoursSpec ? { openingHoursSpecification: profile.openingHoursSpec } : {}),
    sameAs: profile.sameAs,
  };

  return (
    <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(storeJsonLd) }} />
      <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Contact us</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Visit our store in Tech Zone IV, Greater Noida{profile.areaNote ? ` (${profile.areaNote})` : ""} — opposite D-Mart — or message us on WhatsApp.
      </p>

      <div className="mt-8">
        <StoreLocation />
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2">
        <div>
          <p className="text-sm font-semibold text-foreground">Email</p>
          <a href={`mailto:${profile.email}`} className="mt-1 block text-sm text-brand-orange hover:underline">
            {profile.email}
          </a>
        </div>
        <div>
          <p className="text-sm font-semibold text-foreground">Hours</p>
          <p className="mt-1 text-sm text-muted-foreground">{profile.hoursText ?? "Please call or WhatsApp to confirm our opening hours."}</p>
        </div>
      </div>

      <div className="mt-8 rounded-xl border border-brand-orange/20 bg-brand-orange/5 p-4">
        <p className="text-sm font-semibold text-foreground">Bulk &amp; business orders</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Buying for your office or team? WhatsApp us for bulk pricing and IT support.
        </p>
        <a
          href={whatsappLink(profile, "Hi, I'd like to enquire about a bulk/business order.")}
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
