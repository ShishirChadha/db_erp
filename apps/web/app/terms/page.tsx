import type { Metadata } from "next";
import { LegalDraftNotice } from "@/components/LegalDraftNotice";

export const metadata: Metadata = {
  title: "Terms & Conditions",
  robots: { index: false },
};

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground">Terms &amp; Conditions</h1>
      <p className="mt-1 text-sm text-muted-foreground">Last updated: [date]</p>

      <div className="mt-6">
        <LegalDraftNotice />
      </div>

      <div className="space-y-6 text-sm leading-relaxed text-foreground">
        <section>
          <h2 className="mb-2 font-heading text-base font-bold">1. Who we are</h2>
          <p>
            This website is operated by DigitalBluez (&quot;we&quot;, &quot;us&quot;), registered office at
            [registered business address], GSTIN [GSTIN]. By using this site or placing an order, you agree
            to these terms.
          </p>
        </section>
        <section>
          <h2 className="mb-2 font-heading text-base font-bold">2. Products</h2>
          <p>
            All products listed are refurbished/pre-owned unless stated otherwise. Each unit is
            quality-checked before listing and is sold with the condition grade and specifications shown on
            its product page. Product images are of the actual condition grade represented; where the exact
            unit is one-of-a-kind, the listing is removed once sold.
          </p>
        </section>
        <section>
          <h2 className="mb-2 font-heading text-base font-bold">3. Pricing &amp; payment</h2>
          <p>
            Prices are listed in INR and include applicable GST; a GST invoice is issued for every order.
            Payments are processed securely by Razorpay; we do not store your card or bank details.
          </p>
        </section>
        <section>
          <h2 className="mb-2 font-heading text-base font-bold">4. Warranty</h2>
          <p>
            Every unit is covered by a 6-month warranty from the date of delivery against manufacturing/
            hardware defects arising from normal use, excluding physical/liquid damage and unauthorized
            repairs. [Add full warranty claim process.]
          </p>
        </section>
        <section>
          <h2 className="mb-2 font-heading text-base font-bold">5. Returns &amp; cancellations</h2>
          <p>
            [Return window in days], [condition of return], [who bears return shipping]. Orders can be
            cancelled [before dispatch / within X hours] via [account page / WhatsApp / email].
          </p>
        </section>
        <section>
          <h2 className="mb-2 font-heading text-base font-bold">6. Shipping</h2>
          <p>[Delivery timelines, serviceable pincodes, shipping charges, courier partner(s).]</p>
        </section>
        <section>
          <h2 className="mb-2 font-heading text-base font-bold">7. Limitation of liability</h2>
          <p>[Standard limitation-of-liability clause -- to be reviewed by counsel.]</p>
        </section>
        <section>
          <h2 className="mb-2 font-heading text-base font-bold">8. Governing law</h2>
          <p>These terms are governed by the laws of India, courts at [city] having exclusive jurisdiction.</p>
        </section>
        <section>
          <h2 className="mb-2 font-heading text-base font-bold">9. Contact</h2>
          <p>
            Questions about these terms: <a href="mailto:info@digitalbluez.com" className="text-brand-orange underline">info@digitalbluez.com</a> or{" "}
            <a href="https://wa.me/919991111193" className="text-brand-orange underline">+91 99911 11193</a>.
          </p>
        </section>
      </div>
    </main>
  );
}
