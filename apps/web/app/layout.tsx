import type { Metadata } from "next";
import { Archivo, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { WhatsAppButton } from "@/components/WhatsAppButton";
import { Analytics } from "@/components/Analytics";
import { BUSINESS_PHONE_TEL, GOOGLE_RATING, GOOGLE_REVIEW_COUNT, SOCIAL_LINKS } from "@/lib/business-info";

// Archivo carries the storefront's retail energy in headlines/prices/badges;
// IBM Plex Sans handles body copy and UI text and has solid tabular numerals
// for spec tables. Deliberately distinct from the ERP's Geist-on-neutral-grey
// admin theme -- this is a consumer storefront, not a dashboard.
const archivo = Archivo({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
});

const ibmPlexSans = IBM_Plex_Sans({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3001";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "DigitalBluez — Refurbished Laptops, Desktops & Monitors",
    template: "%s | DigitalBluez",
  },
  description:
    "Quality-checked refurbished laptops, desktops, monitors and accessories, backed by warranty.",
  openGraph: {
    siteName: "DigitalBluez",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
  },
  icons: {
    icon: "/favicon-32.png",
    apple: "/apple-touch-icon.png",
  },
};

const organizationJsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "DigitalBluez",
  url: SITE_URL,
  logo: `${SITE_URL}/dbz-logo.png`,
  description: "Quality-checked refurbished laptops, desktops, monitors and accessories.",
  address: {
    "@type": "PostalAddress",
    streetAddress: "9th Floor, T-3 Building, Golden I, Unit No. 915, Plot No. 11, opposite D-Mart, Tech Zone IV",
    addressLocality: "Greater Noida",
    addressRegion: "Uttar Pradesh",
    postalCode: "201306",
    addressCountry: "IN",
  },
  aggregateRating: {
    "@type": "AggregateRating",
    ratingValue: GOOGLE_RATING,
    reviewCount: GOOGLE_REVIEW_COUNT,
  },
  sameAs: [SOCIAL_LINKS.instagram, SOCIAL_LINKS.facebook, SOCIAL_LINKS.linkedin],
  contactPoint: {
    "@type": "ContactPoint",
    telephone: BUSINESS_PHONE_TEL,
    contactType: "customer service",
  },
};

const websiteJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "DigitalBluez",
  url: SITE_URL,
  potentialAction: {
    "@type": "SearchAction",
    target: `${SITE_URL}/search?q={search_term_string}`,
    "query-input": "required name=search_term_string",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${archivo.variable} ${ibmPlexSans.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-background font-sans text-foreground">
        <script
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
        />
        <script
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteJsonLd) }}
        />
        <SiteHeader />
        <div className="flex-1">{children}</div>
        <SiteFooter />
        <WhatsAppButton />
        <Analytics />
      </body>
    </html>
  );
}
