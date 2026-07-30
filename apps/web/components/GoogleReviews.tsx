import { GOOGLE_PROFILE_URL, GOOGLE_RATING, GOOGLE_REVIEW_COUNT } from "@/lib/business-info";

// Review text taken directly from DigitalBluez's actual Google Business
// Profile (screenshotted by the owner, 2026-07-29) -- never invented.
const RATING = GOOGLE_RATING;
const REVIEW_COUNT = GOOGLE_REVIEW_COUNT;
const PROFILE_URL = GOOGLE_PROFILE_URL;

const REVIEWS = [
  {
    name: "Boby Verma",
    text: "I recently purchased a refurbished laptop in Noida, and I'm extremely happy with the quality and service. The laptop is in excellent condition, works smoothly, and feels almost like a brand-new one. The staff is professional, honest, and very helpful.",
    timeAgo: "6 months ago",
  },
  {
    name: "Reyaz Ahmed",
    text: "I am giving this review after 6 months of laptop usage. Laptop is working as good as new. You can trust Digitalbluez blindly. Purchasing 2nd laptop from there. You will get best price as they are wholesaler.",
    timeAgo: "2 months ago",
  },
  {
    name: "Ujjwal",
    text: "After 1 year of usage, I am giving this review to appreciate Digitalbluez. I purchased a commercial series laptop Dell Latitude 5411 i7 with 16GB RAM and 512GB SSD. There have been no problems and you can trust them blindly.",
    timeAgo: "4 months ago",
  },
];

function Stars() {
  return (
    <span className="text-brand-orange">
      {"★★★★★"}
    </span>
  );
}

export function GoogleRatingBadge() {
  return (
    <a
      href={PROFILE_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-2.5 rounded-full border border-border bg-card px-4 py-2 transition-colors hover:border-brand-orange/30"
    >
      <span className="font-heading text-lg font-bold text-foreground">{RATING}</span>
      <Stars />
      <span className="text-sm text-muted-foreground">{REVIEW_COUNT} Google reviews</span>
    </a>
  );
}

export function GoogleReviews() {
  return (
    <div>
      <GoogleRatingBadge />

      <div className="stagger mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {REVIEWS.map((r) => (
          <div key={r.name} className="rounded-xl border border-border bg-card p-5">
            <Stars />
            <p className="mt-2 line-clamp-5 text-sm text-foreground">&ldquo;{r.text}&rdquo;</p>
            <p className="mt-3 text-xs font-semibold text-muted-foreground">{r.name} · {r.timeAgo}</p>
          </div>
        ))}
      </div>

      <a
        href={PROFILE_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-4 inline-block text-sm font-semibold text-brand-orange hover:underline"
      >
        View all Google reviews →
      </a>
    </div>
  );
}
