import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { withSeoOverride } from "@/lib/seo-data";
import { GoogleReviews } from "@/components/GoogleReviews";
import { TrustBadges } from "@/components/TrustBadges";
import { MarkdownBody } from "@/lib/markdown";
import { getSiteProfile, getTeamMembers } from "@/lib/site-profile";
import { productImageUrl } from "@/lib/image-url";

// Everything on this page except the policy summary comes from the owner-managed
// company profile (ERP: Settings -> Website Admin -> Company & About), so it can
// be edited without a developer. Empty blocks (no photo, no team) simply don't render.
export const revalidate = 60;

const baseMetadata: Metadata = {
  title: "About Us",
  description: "DigitalBluez sells tested refurbished laptops and desktops from its store in Greater Noida, and online across India.",
  alternates: { canonical: "/about" },
};

export async function generateMetadata(): Promise<Metadata> {
  return withSeoOverride(baseMetadata, "static", "/about");
}

// MarkdownBody adds its own top margin; this keeps About's sections evenly spaced.
function Prose({ source }: { source: string }) {
  return <div className="-mt-6"><MarkdownBody source={source} /></div>;
}

function Photo({ path, alt, className }: { path: string; alt: string; className?: string }) {
  return (
    <div className={`relative overflow-hidden rounded-xl bg-muted ${className ?? ""}`}>
      <Image src={productImageUrl(path)} alt={alt} fill sizes="(min-width: 768px) 33vw, 100vw" className="object-cover" />
    </div>
  );
}

export default async function AboutPage() {
  const [profile, team] = await Promise.all([getSiteProfile(), getTeamMembers()]);
  const f = profile.founder;
  const hasFounder = !!(f.name && (f.bioMd || f.photoPath));

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground sm:text-3xl">About DigitalBluez</h1>
      {profile.yearStarted && <p className="mt-1 text-sm text-muted-foreground">Since {profile.yearStarted}</p>}

      <div className="mt-6 space-y-2">
        {profile.aboutStoryMd && <Prose source={profile.aboutStoryMd} />}
        {profile.missionMd && <Prose source={profile.missionMd} />}
      </div>

      {profile.storePhotos.length > 0 && (
        <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {profile.storePhotos.map((p) => (
            <figure key={p.path}>
              <Photo path={p.path} alt={p.alt} className="aspect-[4/3]" />
              {p.caption && <figcaption className="mt-1 text-xs text-muted-foreground">{p.caption}</figcaption>}
            </figure>
          ))}
        </div>
      )}

      {profile.servicesMd && (
        <section className="mt-10">
          <h2 className="font-heading text-lg font-bold text-foreground">What we do</h2>
          <Prose source={profile.servicesMd} />
        </section>
      )}

      {profile.testingNoteMd && (
        <section className="mt-10">
          <h2 className="font-heading text-lg font-bold text-foreground">How we check every laptop</h2>
          <Prose source={profile.testingNoteMd} />
        </section>
      )}

      <section className="mt-10">
        <h2 className="font-heading text-lg font-bold text-foreground">What you get</h2>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm leading-relaxed text-foreground">
          <li>A <Link href="/warranty" className="text-brand-orange underline">6-month warranty</Link> on laptops, desktops, monitors and tablets.</li>
          <li>A GST invoice with every order.</li>
          <li>A <Link href="/replacement-policy" className="text-brand-orange underline">replacement guarantee</Link> if something arrives faulty.</li>
          <li>A <Link href="/buyback" className="text-brand-orange underline">trade-in quote</Link> for your old laptop.</li>
        </ul>
      </section>

      {hasFounder && (
        <section className="mt-10">
          <h2 className="font-heading text-lg font-bold text-foreground">Who we are</h2>
          <div className="mt-4 flex flex-col gap-4 sm:flex-row">
            {f.photoPath && <Photo path={f.photoPath} alt={`${f.name}, ${f.role ?? "founder"}`} className="aspect-square w-32 shrink-0" />}
            <div>
              <p className="font-semibold text-foreground">{f.name}{f.role ? <span className="font-normal text-muted-foreground"> · {f.role}</span> : null}</p>
              {f.bioMd && <Prose source={f.bioMd} />}
            </div>
          </div>
        </section>
      )}

      {team.length > 0 && (
        <section className="mt-10">
          <h2 className="font-heading text-lg font-bold text-foreground">Our team</h2>
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
            {team.map((m) => (
              <div key={m.id}>
                {m.photo_path && <Photo path={m.photo_path} alt={`${m.name}${m.role ? `, ${m.role}` : ""}`} className="aspect-square" />}
                <p className="mt-2 text-sm font-semibold text-foreground">{m.name}</p>
                {m.role && <p className="text-xs text-muted-foreground">{m.role}</p>}
                {m.bio && <p className="mt-1 text-xs text-muted-foreground">{m.bio}</p>}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="mt-10">
        <h2 className="font-heading text-lg font-bold text-foreground">Visit us</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {profile.addressLines.map((line) => (
            <span key={line} className="block">{line}</span>
          ))}
          {profile.areaNote && <span className="block">({profile.areaNote})</span>}
        </p>
        {profile.hoursText && <p className="mt-2 text-sm text-muted-foreground">{profile.hoursText}</p>}
        <p className="mt-2 text-sm">
          <a href={`tel:${profile.phoneTel}`} className="font-semibold text-brand-orange hover:underline">{profile.phoneDisplay}</a>
          {" · "}
          <Link href="/contact" className="text-brand-orange hover:underline">Directions &amp; contact</Link>
        </p>
        {(profile.legalName || profile.gstin) && (
          <p className="mt-3 text-xs text-muted-foreground">
            {profile.legalName}{profile.legalName && profile.gstin ? " · " : ""}{profile.gstin ? `GST-registered (GSTIN ${profile.gstin})` : ""}
          </p>
        )}
      </section>

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
