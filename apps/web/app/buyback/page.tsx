import type { Metadata } from "next";
import { LegalDraftNotice } from "@/components/LegalDraftNotice";
import { WHATSAPP_NUMBER, BUSINESS_EMAIL, BUYBACK_PERCENT, BUYBACK_WINDOW_MONTHS } from "@/lib/business-info";

export const metadata: Metadata = {
  title: "Buyback Guarantee",
  robots: { index: false },
};

export default function BuybackPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground">Buyback Guarantee</h1>
      <p className="mt-1 text-sm text-muted-foreground">Last updated: [date]</p>

      <div className="mt-6">
        <LegalDraftNotice />
      </div>

      <div className="space-y-6 text-sm leading-relaxed text-foreground">
        <section>
          <h2 className="mb-2 font-heading text-base font-bold">How it works</h2>
          <p>
            On eligible laptops, desktops, monitors and tablets, DigitalBluez guarantees to buy back your
            unit for <strong>{BUYBACK_PERCENT}% of its purchase price</strong>, provided the request is made
            within <strong>{BUYBACK_WINDOW_MONTHS} months</strong> of delivery. The guaranteed amount is fixed
            at the time of purchase and shown on the product page.
          </p>
        </section>
        <section>
          <h2 className="mb-2 font-heading text-base font-bold">Eligibility</h2>
          <p>
            The unit must be in working condition, matching the condition it was delivered in (normal wear
            excepted), with no physical/liquid damage and no unauthorized repairs or component swaps.
            [Confirm any additional eligibility conditions, e.g. original accessories/charger required.]
          </p>
        </section>
        <section>
          <h2 className="mb-2 font-heading text-base font-bold">What's not covered</h2>
          <p>[Confirm exclusions -- e.g. accessories/monitors/ACC-category items, units bought during a sale, etc.]</p>
        </section>
        <section>
          <h2 className="mb-2 font-heading text-base font-bold">How to redeem</h2>
          <p>
            Message us on{" "}
            <a href={`https://wa.me/${WHATSAPP_NUMBER}`} className="text-brand-orange underline">WhatsApp</a> or email{" "}
            <a href={`mailto:${BUSINESS_EMAIL}`} className="text-brand-orange underline">{BUSINESS_EMAIL}</a> with
            your order number. [Confirm inspection process, payout method, and timeline.]
          </p>
        </section>
      </div>
    </main>
  );
}
