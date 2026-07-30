import type { Metadata } from "next";
import { GoogleReviews } from "@/components/GoogleReviews";
import { TrustBadges } from "@/components/TrustBadges";

export const metadata: Metadata = {
  title: "About Us",
  description: "DigitalBluez is a One Stop IT Solutions store for refurbished laptops, desktops and IT support in Greater Noida.",
  alternates: { canonical: "/about" },
};

export default function AboutPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Our Story</h1>

      <div className="mt-6 space-y-4 text-sm leading-relaxed text-foreground">
        <p>
          DigitalBluez is your one-stop shop for refurbished laptops, desktops &amp; IT solutions. We
          provide high-quality renewed laptops, used desktops, and computer accessories at competitive
          prices — every unit inspected, warrantied, and ready to work as good as new.
        </p>
        <p>
          [Add your founding story here — when DigitalBluez started, why, and what problem you set out to
          solve. e.g. how many years in the refurbished/IT business, notable milestones.]
        </p>
        <p>
          [Add a short note on your team / what makes your quality-check process trustworthy — this is
          the kind of detail that turns a first-time buyer into a repeat one.]
        </p>
      </div>

      <div className="mt-10 rounded-xl border border-border bg-secondary/40 p-5">
        <TrustBadges compact />
      </div>

      <div className="mt-10">
        <h2 className="mb-4 font-heading text-lg font-bold text-foreground">What our customers say</h2>
        <GoogleReviews />
      </div>
    </main>
  );
}
