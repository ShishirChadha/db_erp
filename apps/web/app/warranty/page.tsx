import type { Metadata } from "next";
import { LegalDraftNotice } from "@/components/LegalDraftNotice";

export const metadata: Metadata = {
  title: "Warranty Policy",
  description: "Every DigitalBluez unit comes with a 6-month warranty.",
  alternates: { canonical: "/warranty" },
  robots: { index: false },
};

export default function WarrantyPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground">Warranty Policy</h1>
      <p className="mt-1 text-sm text-muted-foreground">Last updated: [date]</p>

      <div className="mt-6">
        <LegalDraftNotice />
      </div>

      <div className="space-y-6 text-sm leading-relaxed text-foreground">
        <section>
          <h2 className="mb-2 font-heading text-base font-bold">Coverage</h2>
          <p>
            Every unit sold by DigitalBluez comes with a <strong>6-month warranty</strong> from the date of
            delivery, covering hardware/manufacturing defects that arise from normal use.
          </p>
        </section>
        <section>
          <h2 className="mb-2 font-heading text-base font-bold">What&apos;s covered</h2>
          <p>[List covered components, e.g. motherboard, RAM, storage, keyboard, hinges, battery health above X%.]</p>
        </section>
        <section>
          <h2 className="mb-2 font-heading text-base font-bold">What&apos;s not covered</h2>
          <p>
            Physical or liquid damage, damage from unauthorized repair/modification, normal wear and tear
            (e.g. battery degradation beyond the covered threshold), and software issues unrelated to
            hardware are not covered. [Confirm/adjust exclusions.]
          </p>
        </section>
        <section>
          <h2 className="mb-2 font-heading text-base font-bold">How to make a claim</h2>
          <p>
            Contact us via <a href="https://wa.me/919991111193" className="text-brand-orange underline">WhatsApp (+91 99911 11193)</a> or{" "}
            <a href="mailto:info@digitalbluez.com" className="text-brand-orange underline">info@digitalbluez.com</a> with
            your order number and a description of the issue. [Add turnaround time, whether pickup is
            arranged, repair vs. replacement policy, and any diagnostic fee for out-of-warranty issues.]
          </p>
        </section>
        <section>
          <h2 className="mb-2 font-heading text-base font-bold">Extended warranty</h2>
          <p>[If you offer a paid extended-warranty option, describe it here; otherwise remove this section.]</p>
        </section>
      </div>
    </main>
  );
}
