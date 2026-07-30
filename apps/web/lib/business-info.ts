// Single source for DigitalBluez's real, verified contact/business facts --
// confirmed against digitalbluez.com and the owner's actual Google Business
// Profile (screenshotted 2026-07-29). Update here, not at each call site.
export const BUSINESS_NAME = "DigitalBluez";
export const BUSINESS_PHONE_DISPLAY = "+91 99911 11193";
export const BUSINESS_PHONE_TEL = "+919991111193";
export const WHATSAPP_NUMBER = "919991111193";
export const BUSINESS_EMAIL = "info@digitalbluez.com";

export const BUSINESS_ADDRESS_LINES = [
  "9th Floor, T-3 Building, Golden I,",
  "Unit No. 915, Plot No. 11, opposite D-Mart,",
  "Tech Zone IV, Greater Noida, Uttar Pradesh 201306",
];
export const BUSINESS_ADDRESS_SINGLE_LINE =
  "9th Floor, T-3 Building, Golden I, Unit No. 915, Plot No. 11, opposite D-Mart, Tech Zone IV, Greater Noida, Uttar Pradesh 201306";

export const GOOGLE_MAPS_EMBED_SRC =
  "https://maps.google.com/maps?q=" +
  encodeURIComponent("Golden I, Tech Zone IV, Greater Noida West") +
  "&t=m&z=15&output=embed&iwloc=near";

export const GOOGLE_PROFILE_URL = "https://share.google/VU2Seda0g0eWFF5IV";
export const GOOGLE_RATING = 4.9;
export const GOOGLE_REVIEW_COUNT = 97;

export const SOCIAL_LINKS = {
  instagram: "https://www.instagram.com/digitalbluezlaptops/",
  facebook: "https://www.facebook.com/Digitalbluez",
  linkedin: "https://www.linkedin.com/company/digitalbluez/",
};

// Buyback guarantee -- flat-window model (chosen 2026-07-29, replacing NewJaisa's
// multi-tier slider with something simpler to both display and commit to).
// PLACEHOLDER VALUES -- not yet a confirmed DigitalBluez policy. Do not treat
// as live/binding until the owner confirms real numbers; see /buyback page.
export const BUYBACK_PERCENT = 40; // [confirm real %]
export const BUYBACK_WINDOW_MONTHS = 12; // [confirm real window]
