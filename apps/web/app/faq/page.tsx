import type { Metadata } from "next";
import { withSeoOverride } from "@/lib/seo-data";
import Link from "next/link";
import { getSiteProfile } from "@/lib/site-profile";

// Metadata can be overridden from the ERP (Settings -> Website SEO), so this
// page is re-rendered periodically instead of frozen at build time.
export const revalidate = 60;

const baseMetadata: Metadata = {
  title: "Frequently Asked Questions",
  description: "Answers to common questions about buying refurbished laptops and desktops from DigitalBluez — warranty, replacements, delivery, trade-in and payment.",
  alternates: { canonical: "/faq" },
};


export async function generateMetadata(): Promise<Metadata> {
  return withSeoOverride(baseMetadata, "static", "/faq");
}

function buildFaqs(email: string) {
  return [
  {
    q: "Are DigitalBluez's laptops and desktops genuinely refurbished, or just used?",
    a: "Every unit we sell goes through our quality-check process before it's listed: condition grading and, where shown on the product page, a per-unit test report covering the screen, keyboard, trackpad, ports and more. We publish a unit only after it has passed.",
  },
  {
    q: "What warranty do I get?",
    a: "Every laptop, desktop, monitor and tablet has a 6-month warranty from delivery that covers hardware faults from normal use. Accessories carry the warranty shown on their product page. Physical or liquid damage, and motherboard, CPU or GPU damage from shorting, are not covered. See our Warranty Policy for the full terms.",
  },
  {
    q: "What if my laptop arrives faulty?",
    a: "Tell us within 48 hours of delivery, with an unboxing video, if it arrives dead, damaged or wrong, or within 7 days if it has a hardware defect from normal use. We replace it with the same or better specification, or refund you if we can't. See our Replacement Policy.",
  },
  {
    q: "Can I return a laptop if I change my mind?",
    a: "No. We don't accept returns for change of mind, which is why every unit is tested and graded before it's listed. You're welcome to visit our Greater Noida store to see a unit first, or message us on WhatsApp with any question about a specific one.",
  },
  {
    q: "How long does delivery take?",
    a: "Orders ship within 3–6 business days of placement. After that, delivery times are as given by our courier partners. See our Shipping & Delivery Policy.",
  },
  {
    q: "Can I pay cash on delivery?",
    a: "Yes. You pay a part of the amount online when you order, and the rest on delivery. A cash-on-delivery handling fee applies and is shown at checkout before you pay.",
  },
  {
    q: "Do you take trade-ins?",
    a: "Yes. Message us on WhatsApp with the model and a few photos of your old laptop or desktop and we'll give you a quote. The final price is confirmed after we inspect the unit.",
  },
  {
    q: "Do you provide a GST invoice?",
    a: "Yes — DigitalBluez is GST-registered, and a proper tax invoice is available for orders placed through us.",
  },
  {
    q: "How can I get help before or after ordering?",
    a: `Message us on WhatsApp or email ${email} — we're happy to answer questions about a specific unit before you buy.`,
  },
  ];
}

export default async function FaqPage() {
  const profile = await getSiteProfile();
  const FAQS = buildFaqs(profile.email);
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQS.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground">Frequently Asked Questions</h1>

      <div className="mt-6 space-y-6">
        {FAQS.map((f) => (
          <div key={f.q}>
            <h2 className="font-heading text-base font-bold text-foreground">{f.q}</h2>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{f.a}</p>
          </div>
        ))}
      </div>

      <div className="mt-10 flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-4 text-sm">
        <Link href="/warranty" className="text-brand-orange hover:underline">Warranty Policy</Link>
        <Link href="/replacement-policy" className="text-brand-orange hover:underline">Replacement Policy</Link>
        <Link href="/shipping-policy" className="text-brand-orange hover:underline">Shipping &amp; Delivery</Link>
        <Link href="/buyback" className="text-brand-orange hover:underline">Trade-in</Link>
        <a href={`https://wa.me/${profile.whatsappNumber}`} target="_blank" rel="noopener noreferrer" className="text-brand-orange hover:underline">
          Ask us on WhatsApp
        </a>
      </div>
    </main>
  );
}
