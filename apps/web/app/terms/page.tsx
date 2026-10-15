import type { Metadata } from "next";
import Link from "next/link";
import { withSeoOverride } from "@/lib/seo-data";
import { PolicyLayout, PolicySection } from "@/components/PolicyLayout";
import { getSiteProfile, formatLongDate } from "@/lib/site-profile";

export const revalidate = 60;

// noindex until the owner's CA / lawyer has reviewed the text; flip it from
// Settings -> Website SEO -> Page metadata (no deploy needed).
const baseMetadata: Metadata = {
  title: "Terms & Conditions",
  description: "The terms that apply when you buy from DigitalBluez.",
  alternates: { canonical: "/terms" },
  robots: { index: false },
};

export async function generateMetadata(): Promise<Metadata> {
  return withSeoOverride(baseMetadata, "static", "/terms");
}

export default async function TermsPage() {
  const profile = await getSiteProfile();
  const company = profile.legalName ?? profile.businessName;

  return (
    <PolicyLayout title="Terms & Conditions" updated={formatLongDate(profile.termsUpdatedOn) ?? "—"}>
      <PolicySection title="1. Who we are">
        <p>
          {company}{profile.gstin ? `, GSTIN ${profile.gstin}` : ""}, {profile.addressSingleLine}. By using this site or placing an
          order, you agree to these terms.
        </p>
      </PolicySection>

      <PolicySection title="2. Products">
        <p>
          Our laptops and desktops are refurbished and each is a single unit. Photos and specifications describe the exact unit.
          A unit is held for 15 minutes during checkout and may be unavailable after that.
        </p>
      </PolicySection>

      <PolicySection title="3. Prices and payment">
        <p>
          Prices are in INR and a GST invoice is provided. Pay by UPI or card through Razorpay, or by cash on delivery with the
          advance and handling fee shown at checkout.
        </p>
      </PolicySection>

      <PolicySection title="4. Orders and cancellation">
        <p>
          An order is confirmed when payment succeeds. To cancel, contact us as soon as possible; whether it can be cancelled
          depends on whether it has been dispatched.
        </p>
      </PolicySection>

      <PolicySection title="5. Delivery">
        <p>See our <Link href="/shipping-policy" className="text-brand-orange underline">Shipping &amp; Delivery Policy</Link>.</p>
      </PolicySection>

      <PolicySection title="6. Warranty and replacement">
        <p>
          See our <Link href="/warranty" className="text-brand-orange underline">Warranty Policy</Link> and{" "}
          <Link href="/replacement-policy" className="text-brand-orange underline">Replacement Policy</Link>. We do not accept
          change-of-mind returns.
        </p>
      </PolicySection>

      <PolicySection title="7. Trade-ins">
        <p>Quotes are estimates and the final price is confirmed after inspection.</p>
      </PolicySection>

      <PolicySection title="8. Your account">
        <p>Give accurate information and keep your password private.</p>
      </PolicySection>

      <PolicySection title="9. Use of the site">
        <p>Don&apos;t misuse the site or copy its content or images without permission.</p>
      </PolicySection>

      <PolicySection title="10. Liability">
        <p>
          To the extent the law allows, we aren&apos;t liable for indirect losses or data loss. Nothing here limits your rights
          under Indian consumer law.
        </p>
      </PolicySection>

      <PolicySection title="11. Governing law">
        <p>
          Indian law applies. Courts at {profile.legalJurisdiction} have jurisdiction, without limiting your right to approach a
          consumer commission.
        </p>
      </PolicySection>

      <PolicySection title="12. Contact">
        <p>
          <a href={`mailto:${profile.email}`} className="text-brand-orange underline">{profile.email}</a>, {profile.phoneDisplay}, or
          our Grievance Officer, {profile.grievance.name}, at{" "}
          <a href={`mailto:${profile.grievance.email}`} className="text-brand-orange underline">{profile.grievance.email}</a>.
        </p>
      </PolicySection>
    </PolicyLayout>
  );
}
