import type { Metadata } from "next";
import { LegalDraftNotice } from "@/components/LegalDraftNotice";
import { WHATSAPP_NUMBER, BUSINESS_EMAIL } from "@/lib/business-info";

export const metadata: Metadata = {
  title: "Return Policy",
  robots: { index: false },
};

export default function ReturnPolicyPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground">Return Policy</h1>
      <p className="mt-1 text-sm text-muted-foreground">Last updated: [date]</p>

      <div className="mt-6">
        <LegalDraftNotice />
      </div>

      <div className="space-y-6 text-sm leading-relaxed text-foreground">
        <section>
          <h2 className="mb-2 font-heading text-base font-bold">Return window</h2>
          <p>
            You may request a return within [X] days of delivery if the unit does not match the condition
            grade or specifications listed on its product page, or arrives with a defect not caused by
            transit damage. [Confirm window length and any exceptions, e.g. accessories/opened software.]
          </p>
        </section>
        <section>
          <h2 className="mb-2 font-heading text-base font-bold">Condition for return</h2>
          <p>
            The unit must be returned in the condition it was delivered, with all original accessories and
            packaging. [Add any condition-specific exclusions.]
          </p>
        </section>
        <section>
          <h2 className="mb-2 font-heading text-base font-bold">Shipping &amp; pickup</h2>
          <p>
            [Who arranges/pays for return pickup — DigitalBluez or the customer? Which courier?]
          </p>
        </section>
        <section>
          <h2 className="mb-2 font-heading text-base font-bold">Refunds</h2>
          <p>
            Once the returned unit is received and inspected, refunds are issued to the original payment
            method via Razorpay within [X] business days. [Confirm refund timeline and whether it's full or
            includes a restocking/inspection deduction.]
          </p>
        </section>
        <section>
          <h2 className="mb-2 font-heading text-base font-bold">Cancellations</h2>
          <p>
            Orders can be cancelled free of charge [before dispatch / within X hours of placing the order].
            Contact us as soon as possible to request a cancellation.
          </p>
        </section>
        <section>
          <h2 className="mb-2 font-heading text-base font-bold">How to start a return</h2>
          <p>
            Message us on{" "}
            <a href={`https://wa.me/${WHATSAPP_NUMBER}`} className="text-brand-orange underline">WhatsApp</a> or email{" "}
            <a href={`mailto:${BUSINESS_EMAIL}`} className="text-brand-orange underline">{BUSINESS_EMAIL}</a> with
            your order number and the reason for return.
          </p>
        </section>
      </div>
    </main>
  );
}
