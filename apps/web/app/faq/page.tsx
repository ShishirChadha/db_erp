import type { Metadata } from "next";
import Link from "next/link";
import { WHATSAPP_NUMBER, BUSINESS_EMAIL, BUYBACK_PERCENT, BUYBACK_WINDOW_MONTHS } from "@/lib/business-info";

export const metadata: Metadata = {
  title: "Frequently Asked Questions",
  description: "Answers to common questions about buying refurbished laptops and desktops from DigitalBluez — warranty, returns, buyback, and payment.",
  alternates: { canonical: "/faq" },
};

const FAQS = [
  {
    q: "Are DigitalBluez's laptops and desktops genuinely refurbished, or just used?",
    a: "Every unit we sell goes through our quality-check process before it's listed — condition grading, and (where shown on the product page) a per-unit test report covering things like battery health, keyboard, ports, and boot. We publish a unit only after it's passed.",
  },
  {
    q: "What warranty do I get?",
    a: "Warranty coverage (type and duration) is shown on each product page for units that have one on file. See our full Warranty Policy for terms.",
  },
  {
    q: "What's your return policy?",
    a: "See our Return Policy page for the current window and conditions.",
  },
  {
    q: "Do you offer a buyback guarantee?",
    a: `Yes — on eligible units, we guarantee to buy back your unit for ${BUYBACK_PERCENT}% of its purchase price within ${BUYBACK_WINDOW_MONTHS} months of delivery. See our Buyback Guarantee page for eligibility and how to redeem it.`,
  },
  {
    q: "Do you provide a GST invoice?",
    a: "Yes — DigitalBluez is GST-registered, and a proper tax invoice is available for orders placed through us.",
  },
  {
    q: "How can I get help before or after ordering?",
    a: `Message us on WhatsApp or email ${BUSINESS_EMAIL} — we're happy to answer questions about a specific unit before you buy.`,
  },
];

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQS.map((f) => ({
    "@type": "Question",
    name: f.q,
    acceptedAnswer: { "@type": "Answer", text: f.a },
  })),
};

export default function FaqPage() {
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
        <Link href="/return-policy" className="text-brand-orange hover:underline">Return Policy</Link>
        <Link href="/buyback" className="text-brand-orange hover:underline">Buyback Guarantee</Link>
        <a href={`https://wa.me/${WHATSAPP_NUMBER}`} target="_blank" rel="noopener noreferrer" className="text-brand-orange hover:underline">
          Ask us on WhatsApp
        </a>
      </div>
    </main>
  );
}
