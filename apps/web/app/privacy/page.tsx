import type { Metadata } from "next";
import { withSeoOverride } from "@/lib/seo-data";
import { PolicyLayout, PolicySection } from "@/components/PolicyLayout";
import { getSiteProfile, formatLongDate } from "@/lib/site-profile";

// Metadata can be overridden from the ERP (Settings -> Website SEO), so this
// page is re-rendered periodically instead of frozen at build time.
export const revalidate = 60;

// noindex until the owner's CA / lawyer has reviewed the text; flip it from
// Settings -> Website SEO -> Page metadata (no deploy needed).
const baseMetadata: Metadata = {
  title: "Privacy Policy",
  description: "How DigitalBluez collects, uses and protects your personal data.",
  alternates: { canonical: "/privacy" },
  robots: { index: false },
};

export async function generateMetadata(): Promise<Metadata> {
  return withSeoOverride(baseMetadata, "static", "/privacy");
}

export default async function PrivacyPage() {
  const profile = await getSiteProfile();
  const company = profile.legalName ?? profile.businessName;
  const dp = profile.dataProtection;

  return (
    <PolicyLayout title="Privacy Policy" updated={formatLongDate(profile.privacyUpdatedOn) ?? "—"}>
      <PolicySection title="1. Who we are">
        <p>{company} decides how your personal data is used.</p>
      </PolicySection>

      <PolicySection title="2. What we collect">
        <p>
          Your name, email, phone number and password (stored securely hashed); delivery addresses and order history; messages
          you send us; your email if you join our newsletter; and basic technical data such as your IP address and device type.
          Payments are handled by Razorpay, and we do not store your card or UPI details.
        </p>
      </PolicySection>

      <PolicySection title="3. Why we use it">
        <p>
          To process orders, deliver them, honour warranties and replacements, issue GST invoices and keep legal and tax records,
          answer support requests, prevent fraud, and improve the site. We send marketing only if you subscribed, and you can
          unsubscribe at any time.
        </p>
      </PolicySection>

      <PolicySection title="4. Who we share it with">
        <p>
          Razorpay (payments), couriers (name, phone and address), Google Analytics (only after you accept cookies), our email
          provider, our website and database hosts, and authorities or our accountants where the law requires. We do not sell your data.
        </p>
      </PolicySection>

      <PolicySection title="5. How long we keep it">
        <p>
          {profile.retentionText} Other data is kept while your account is open and deleted on request, unless the law requires
          us to keep it.
        </p>
      </PolicySection>

      <PolicySection title="6. Your rights">
        <p>
          You can ask to see, correct or delete your data, withdraw consent, or make a complaint. Write to {dp.name}, our data
          protection contact, at <a href={`mailto:${dp.email}`} className="text-brand-orange underline">{dp.email}</a>. We
          acknowledge within 48 hours. You may also approach the Data Protection Board of India.
        </p>
      </PolicySection>

      <PolicySection title="7. Cookies">
        <p>
          Essential cookies keep you signed in and remember your cart. Analytics cookies are used only if you accept them in the
          cookie banner.
        </p>
      </PolicySection>

      <PolicySection title="8. Children">
        <p>The site is not meant for people under 18.</p>
      </PolicySection>

      <PolicySection title="9. Changes">
        <p>We will post updates on this page.</p>
      </PolicySection>
    </PolicyLayout>
  );
}
