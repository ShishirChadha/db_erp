import { getSiteProfile } from '@/lib/site-profile'

export async function StoreLocation() {
  const profile = await getSiteProfile()
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div className="flex flex-col justify-center">
        <a
          href={profile.googleProfileUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mb-4 inline-flex w-fit items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 transition-colors hover:border-brand-orange/30"
        >
          {profile.googleRating != null && (
            <>
              <span className="font-heading text-sm font-bold text-foreground">{profile.googleRating}</span>
              <span className="text-brand-orange">★★★★★</span>
            </>
          )}
          <span className="text-xs text-muted-foreground">
            {profile.googleReviewCount != null ? `${profile.googleReviewCount} Google reviews` : 'See our Google reviews'}
          </span>
        </a>
        <p className="text-sm text-muted-foreground">
          {profile.addressLines.map((line) => (
            <span key={line} className="block">{line}</span>
          ))}
        </p>
        <a href={`tel:${profile.phoneTel}`} className="mt-3 text-sm font-semibold text-brand-orange hover:underline">
          {profile.phoneDisplay}
        </a>
        <div className="mt-5 flex flex-wrap gap-2.5">
          <a
            href={`https://maps.google.com/?q=${encodeURIComponent(profile.addressLines.join(', '))}`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:border-brand-orange/40 hover:text-brand-orange"
          >
            Get directions
          </a>
          <a
            href={`https://wa.me/${profile.whatsappNumber}`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full bg-brand-orange px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
          >
            WhatsApp us
          </a>
        </div>
      </div>
      <div className="overflow-hidden rounded-xl border border-border">
        <iframe
          src={profile.mapsEmbedSrc}
          title="DigitalBluez location"
          className="h-full min-h-[280px] w-full"
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
        />
      </div>
    </div>
  )
}
