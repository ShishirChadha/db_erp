import { getSiteProfile, formatLongDate } from "@/lib/site-profile";

// Review text taken directly from DigitalBluez's actual Google Business
// Profile (screenshotted by the owner, 2026-07-29) -- never invented. The
// rating, review count and profile link come from the owner-managed company
// profile (Website Admin -> Company & About). Relative times ("6 months ago")
// were dropped: they were frozen at the screenshot date and went stale.

const REVIEWS = [
  {
    name: "Boby Verma",
    text: "I recently purchased a refurbished laptop in Noida, and I'm extremely happy with the quality and service. The laptop is in excellent condition, works smoothly, and feels almost like a brand-new one. The staff is professional, honest, and very helpful.",
  },
  {
    name: "Reyaz Ahmed",
    text: "I am giving this review after 6 months of laptop usage. Laptop is working as good as new. You can trust Digitalbluez blindly. Purchasing 2nd laptop from there. You will get best price as they are wholesaler.",
  },
  {
    name: "Ujjwal",
    text: "After 1 year of usage, I am giving this review to appreciate Digitalbluez. I purchased a commercial series laptop Dell Latitude 5411 i7 with 16GB RAM and 512GB SSD. There have been no problems and you can trust them blindly.",
  },
];

function Stars() {
  return (
    <span className="text-brand-orange">
      {"★★★★★"}
    </span>
  );
}

export async function GoogleRatingBadge() {
  const profile = await getSiteProfile();
  const RATING = profile.googleRating;
  const REVIEW_COUNT = profile.googleReviewCount;
  const PROFILE_URL = profile.googleProfileUrl;
  const asOf = formatLongDate(profile.googleRatingAsOf);
  return (
    <a
      href={PROFILE_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-2.5 rounded-full border border-border bg-card px-4 py-2 transition-colors hover:border-brand-orange/30"
    >
      {RATING != null && (
        <>
          <span className="font-heading text-lg font-bold text-foreground">{RATING}</span>
          <Stars />
        </>
      )}
      <span className="text-sm text-muted-foreground" title={asOf ? `As of ${asOf}` : undefined}>
        {REVIEW_COUNT != null ? `${REVIEW_COUNT} Google reviews` : 'See our Google reviews'}
      </span>
    </a>
  );
}

export async function GoogleReviews() {
  const profile = await getSiteProfile();
  return (
    <div>
      <GoogleRatingBadge />

      <div className="stagger mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {REVIEWS.map((r) => (
          <div key={r.name} className="rounded-xl border border-border bg-card p-5">
            <Stars />
            <p className="mt-2 line-clamp-5 text-sm text-foreground">&ldquo;{r.text}&rdquo;</p>
            <p className="mt-3 text-xs font-semibold text-muted-foreground">{r.name} · Google review</p>
          </div>
        ))}
      </div>

      <a
        href={profile.googleProfileUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-4 inline-block text-sm font-semibold text-brand-orange hover:underline"
      >
        View all Google reviews →
      </a>
    </div>
  );
}
