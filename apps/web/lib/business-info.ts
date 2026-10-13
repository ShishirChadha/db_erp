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

// Structured form of the address above, for schema.org markup -- one place, so
// the Organization and LocalBusiness JSON-LD can never disagree with the footer.
export const BUSINESS_POSTAL_ADDRESS = {
  "@type": "PostalAddress",
  streetAddress: "9th Floor, T-3 Building, Golden I, Unit No. 915, Plot No. 11, opposite D-Mart, Tech Zone IV",
  addressLocality: "Greater Noida",
  addressRegion: "Uttar Pradesh",
  postalCode: "201306",
  addressCountry: "IN",
} as const;

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

// Opening hours -- confirmed by the owner 2026-10-13 (same as the Google Business
// Profile): every day, 9 AM to 8 PM.
export const BUSINESS_HOURS_TEXT = "Every day, 9:00 AM – 8:00 PM";
export const BUSINESS_OPENING_HOURS_SPEC = {
  "@type": "OpeningHoursSpecification",
  dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
  opens: "09:00",
  closes: "20:00",
} as const;

// Grievance Officer -- named on the policy pages and in the footer (Consumer
// Protection (E-Commerce) Rules, 2020). Confirmed by the owner 2026-10-13.
export const GRIEVANCE_OFFICER = { name: "Shishir", email: "grievances@digitalbluez.com" };
