import type { Metadata } from "next";
import { StoreLocation } from "@/components/StoreLocation";
import { BUSINESS_EMAIL, WHATSAPP_NUMBER } from "@/lib/business-info";

export const metadata: Metadata = {
  title: "Contact Us",
  description: "Get in touch with DigitalBluez — Greater Noida, Uttar Pradesh.",
  alternates: { canonical: "/contact" },
};

export default function ContactPage() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Contact us</h1>
      <p className="mt-1 text-sm text-muted-foreground">We usually reply within a few hours.</p>

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
          <p className="mt-1 text-sm text-muted-foreground">[Add full opening hours, e.g. Mon–Sat, 9am–7pm.]</p>
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
