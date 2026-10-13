import type { Metadata } from "next";
import { supabaseAdmin } from "@db/db/admin";
import { withSeoOverride } from "@/lib/seo-data";
import { PolicyLayout, PolicySection } from "@/components/PolicyLayout";
import { formatCurrency } from "@db/shared";

export const revalidate = 60;

const baseMetadata: Metadata = {
  title: "Shipping & Delivery Policy",
  description: "How and when DigitalBluez orders are dispatched and delivered across India, and how cash on delivery works.",
  alternates: { canonical: "/shipping-policy" },
};

export async function generateMetadata(): Promise<Metadata> {
  return withSeoOverride(baseMetadata, "static", "/shipping-policy");
}

// Cash-on-delivery terms come from the live checkout settings (ERP: Settings ->
// Website Admin -> Payments), so this page can never disagree with checkout.
async function getCodTerms(): Promise<{ token: number; feePct: number } | null> {
  try {
    const { data } = await supabaseAdmin
      .from("website_payment_settings")
      .select("cod_enabled, cod_token_amount, cod_handling_fee_pct")
      .maybeSingle();
    if (!data?.cod_enabled) return null;
    return { token: Number(data.cod_token_amount), feePct: Number(data.cod_handling_fee_pct) };
  } catch {
    return null;
  }
}

export default async function ShippingPolicyPage() {
  const cod = await getCodTerms();

  return (
    <PolicyLayout title="Shipping & Delivery Policy" updated="13 October 2026">
      <PolicySection title="Dispatch">
        <p>Orders ship within <strong>3–6 business days</strong> of placement.</p>
      </PolicySection>

      <PolicySection title="Delivery">
        <p>
          Delivery times are as given by our courier partners, and a delay of up to 2 days can occur. Timelines apply to
          serviceable areas, not remote locations.
        </p>
      </PolicySection>

      <PolicySection title="Method">
        <p>Standard orders travel by surface (road). Express delivery by air is available where possible.</p>
      </PolicySection>

      <PolicySection title="Shipping charges">
        <p>Shipping is free on orders that include a laptop, desktop, monitor or tablet.</p>
      </PolicySection>

      <PolicySection title="Collect from our store">
        <p>Free pickup from our Greater Noida store. See the contact page for the address and opening hours.</p>
      </PolicySection>

      <PolicySection title="Payment">
        <p>
          Pay online by UPI or card through Razorpay.
          {cod ? (
            <>
              {" "}
              Cash on delivery is also available: you pay {formatCurrency(cod.token)} online when you order (adjusted in your
              bill) and the balance on delivery
              {cod.feePct > 0 ? `, and a ${cod.feePct}% cash-on-delivery handling fee applies. The fee is shown at checkout before you pay.` : "."}
            </>
          ) : null}
        </p>
      </PolicySection>

      <p className="text-muted-foreground">
        Something wrong when it arrives? See our <a href="/replacement-policy" className="text-brand-orange underline">Replacement Policy</a>.
      </p>
    </PolicyLayout>
  );
}
