import type { Metadata } from "next";
import { withSeoOverride } from "@/lib/seo-data";
import { PolicyLayout, PolicySection } from "@/components/PolicyLayout";
import { getSiteProfile, formatLongDate } from "@/lib/site-profile";

export const revalidate = 60;

const baseMetadata: Metadata = {
  title: "Replacement Policy",
  description:
    "What DigitalBluez replaces and how: items that arrive dead, damaged or wrong, and hardware defects within 7 days. We do not accept change-of-mind returns.",
  alternates: { canonical: "/replacement-policy" },
};

export async function generateMetadata(): Promise<Metadata> {
  return withSeoOverride(baseMetadata, "static", "/replacement-policy");
}

export default async function ReplacementPolicyPage() {
  const profile = await getSiteProfile();
  return (
    <PolicyLayout title="Replacement Policy" updated="13 October 2026">
      <p>
        DigitalBluez does not accept returns for change of mind. We replace items that arrive faulty or not as described.
      </p>

      <PolicySection title="We will replace your item if">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            It arrives dead, damaged in transit, or is the wrong item. Tell us within <strong>48 hours</strong> of delivery,
            with an unboxing video.
          </li>
          <li>It has a hardware defect from normal use, reported within <strong>7 days</strong> of delivery.</li>
        </ul>
      </PolicySection>

      <PolicySection title="What we give you">
        <p>
          A replacement of the same or better specification. If we can&apos;t replace it, we refund the full amount to your
          original payment method within 7 working days.
        </p>
      </PolicySection>

      <PolicySection title="Courier">
        <p>
          We pay the courier to send you the replacement, and to collect items that arrive dead, damaged or wrong. For a
          hardware defect found within 7 days, you pay to send the unit back to us.
        </p>
      </PolicySection>

      <PolicySection title="Conditions">
        <p>The unit comes back with its box, charger and accessories, and the serial number matches the one we shipped.</p>
      </PolicySection>

      <PolicySection title="Not eligible">
        <p>
          Physical or liquid damage after delivery, motherboard, CPU or GPU damage from shorting, repair or modification by
          anyone else, and software issues.
        </p>
      </PolicySection>

      <PolicySection title="After 7 days">
        <p>
          The 6-month <a href="/warranty" className="text-brand-orange underline">Warranty Policy</a> applies.
        </p>
      </PolicySection>

      <PolicySection title="To claim">
        <p>
          WhatsApp{" "}
          <a href={`https://wa.me/${profile.whatsappNumber}`} className="text-brand-orange underline">{profile.phoneDisplay}</a> or email{" "}
          <a href={`mailto:${profile.email}`} className="text-brand-orange underline">{profile.email}</a> with your order
          number, photos and the unboxing video.
        </p>
      </PolicySection>

      <PolicySection title="Grievances">
        <p>
          {profile.grievance.name}, Grievance Officer,{" "}
          <a href={`mailto:${profile.grievance.email}`} className="text-brand-orange underline">{profile.grievance.email}</a>.
          We acknowledge within 48 hours and aim to resolve within one month.
        </p>
      </PolicySection>
    </PolicyLayout>
  );
}
