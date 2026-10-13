import type { Metadata } from "next";
import { withSeoOverride } from "@/lib/seo-data";
import { PolicyLayout, PolicySection } from "@/components/PolicyLayout";
import { BUSINESS_EMAIL, BUSINESS_PHONE_DISPLAY, WHATSAPP_NUMBER } from "@/lib/business-info";

// Metadata can be overridden from the ERP (Settings -> Website SEO), so this
// page is re-rendered periodically instead of frozen at build time.
export const revalidate = 60;

const baseMetadata: Metadata = {
  title: "Warranty Policy — 6 months on laptops, desktops, monitors & tablets",
  description:
    "Every DigitalBluez laptop, desktop, monitor and tablet has a 6-month warranty. See what is covered, what is not, and how to claim.",
  alternates: { canonical: "/warranty" },
};

export async function generateMetadata(): Promise<Metadata> {
  return withSeoOverride(baseMetadata, "static", "/warranty");
}

export default function WarrantyPage() {
  return (
    <PolicyLayout title="Warranty Policy" updated="13 October 2026">
      <p>
        Every laptop, desktop, monitor and tablet from DigitalBluez has a <strong>6-month warranty</strong> from the date of
        delivery. Accessories carry the warranty shown on their product page.
      </p>

      <PolicySection title="What is covered">
        <p>
          Hardware failures from normal use: motherboard, RAM, storage, display, keyboard, touchpad, speakers and ports;
          charger defects; and a battery that won&apos;t charge, isn&apos;t detected or swells.
        </p>
      </PolicySection>

      <PolicySection title="What is not covered">
        <ul className="list-disc space-y-1 pl-5">
          <li>Physical damage (cracks, broken screen, bent body, drops).</li>
          <li>Liquid damage.</li>
          <li>Motherboard, CPU or GPU damage caused by an electrical short (shorting).</li>
          <li>Repair or modification by anyone other than DigitalBluez.</li>
          <li>Software issues and data loss.</li>
          <li>Normal wear, including battery capacity falling with age.</li>
        </ul>
      </PolicySection>

      <PolicySection title="What we do">
        <p>
          We repair it. If it can&apos;t be repaired, we replace it with a unit of equal or better specification. If no
          replacement is available, we refund the purchase price.
        </p>
      </PolicySection>

      <PolicySection title="How to claim">
        <p>
          WhatsApp{" "}
          <a href={`https://wa.me/${WHATSAPP_NUMBER}`} className="text-brand-orange underline">{BUSINESS_PHONE_DISPLAY}</a> or email{" "}
          <a href={`mailto:${BUSINESS_EMAIL}`} className="text-brand-orange underline">{BUSINESS_EMAIL}</a> with your order
          number, a photo and a video of the problem. We reply within 2 working days, and most repairs are finished within
          7 working days of the unit reaching us.
        </p>
      </PolicySection>

      <PolicySection title="Courier">
        <p>
          You pay to send the unit to us. We pay to send the repaired or replacement unit back. Walk-in service at our
          Greater Noida store is free.
        </p>
      </PolicySection>

      <PolicySection title="After the warranty">
        <p>Repairs are charged at actual cost, quoted before any work begins.</p>
      </PolicySection>

      <p className="text-muted-foreground">
        Faulty on arrival? See our <a href="/replacement-policy" className="text-brand-orange underline">Replacement Policy</a>.
      </p>
    </PolicyLayout>
  );
}
