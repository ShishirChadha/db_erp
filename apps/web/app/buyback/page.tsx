import type { Metadata } from "next";
import { withSeoOverride } from "@/lib/seo-data";
import { WHATSAPP_NUMBER, BUSINESS_EMAIL } from "@/lib/business-info";
import { PolicyLayout, PolicySection } from "@/components/PolicyLayout";

// Metadata can be overridden from the ERP (Settings -> Website SEO), so this
// page is re-rendered periodically instead of frozen at build time.
export const revalidate = 60;

const baseMetadata: Metadata = {
  title: "Trade-in & Buyback Quote",
  robots: { index: false },
};


export async function generateMetadata(): Promise<Metadata> {
  return withSeoOverride(baseMetadata, "static", "/buyback");
}

export default function BuybackPage() {
  const waHref = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent("Hi, I'd like a trade-in quote for my old laptop/desktop.")}`;
  return (
    <PolicyLayout title="Trade-in & Buyback Quote" updated="13 October 2026">
      <p>
        Want to sell or trade in your old laptop or desktop? We quote each unit individually. There is no fixed
        buyback percentage: the price depends on the model, age and condition.
      </p>

      <PolicySection title="How it works">
        <ol className="list-decimal space-y-1 pl-5">
          <li>
            Message us on <a href={waHref} className="text-brand-orange underline">WhatsApp</a> or email{" "}
            <a href={`mailto:${BUSINESS_EMAIL}`} className="text-brand-orange underline">{BUSINESS_EMAIL}</a> with the brand,
            model, specifications and a few photos.
          </li>
          <li>We give you an estimate. The final price is confirmed after we inspect the unit.</li>
          <li>If you accept, we pay you, or adjust the amount against a purchase from us.</li>
        </ol>
      </PolicySection>

      <PolicySection title="What affects the price">
        <p>
          Model and age, processor, memory and storage, screen and battery condition, and whether it powers on and
          works. Units with physical or liquid damage are valued lower.
        </p>
      </PolicySection>
    </PolicyLayout>
  );
}
