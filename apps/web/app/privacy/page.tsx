import type { Metadata } from "next";
import { LegalDraftNotice } from "@/components/LegalDraftNotice";

export const metadata: Metadata = {
  title: "Privacy Policy",
  robots: { index: false },
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground">Privacy Policy</h1>
      <p className="mt-1 text-sm text-muted-foreground">Last updated: [date]</p>

      <div className="mt-6">
        <LegalDraftNotice />
      </div>

      <div className="space-y-6 text-sm leading-relaxed text-foreground">
        <section>
          <h2 className="mb-2 font-heading text-base font-bold">1. What we collect</h2>
          <p>
            When you create an account, place an order, or contact us, we collect: name, email, phone
            number, shipping address, and order history. We do not collect or store your card/bank details
            — payments are processed directly by Razorpay under its own privacy policy.
          </p>
        </section>
        <section>
          <h2 className="mb-2 font-heading text-base font-bold">2. How we use it</h2>
          <p>
            To process and deliver orders, issue GST invoices, provide order updates (including via
            WhatsApp/email), honour warranty claims, and improve our catalogue and service.
          </p>
        </section>
        <section>
          <h2 className="mb-2 font-heading text-base font-bold">3. Sharing</h2>
          <p>
            We share order data with our payment processor (Razorpay) and delivery/logistics partner(s) only
            as needed to fulfil your order. We do not sell your personal data to third parties.
          </p>
        </section>
        <section>
          <h2 className="mb-2 font-heading text-base font-bold">4. Your rights</h2>
          <p>
            You may request access to, correction of, or deletion of your personal data by contacting us at{" "}
            <a href="mailto:info@digitalbluez.com" className="text-brand-orange underline">info@digitalbluez.com</a>.
            [Add DPDP Act-specific consent/grievance-redressal process and grievance officer name/contact.]
          </p>
        </section>
        <section>
          <h2 className="mb-2 font-heading text-base font-bold">5. Cookies</h2>
          <p>
            We use essential cookies to keep you signed in and remember your cart. [Add details of any
            analytics/marketing cookies once configured.]
          </p>
        </section>
        <section>
          <h2 className="mb-2 font-heading text-base font-bold">6. Contact</h2>
          <p>
            Privacy questions or requests: <a href="mailto:info@digitalbluez.com" className="text-brand-orange underline">info@digitalbluez.com</a> or{" "}
            <a href="https://wa.me/919991111193" className="text-brand-orange underline">+91 99911 11193</a>.
          </p>
        </section>
      </div>
    </main>
  );
}
