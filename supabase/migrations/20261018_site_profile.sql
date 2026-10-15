-- Company & About settings (Settings -> Website Admin -> Company & About).
-- ONE owner-managed public profile replacing the contact/address/hours/legal
-- facts that were hardcoded in five places (apps/web/lib/business-info.ts, the
-- layout JSON-LD, policy pages, marketing_settings.contact_block, card templates).
-- Additive only. Tables are service-role only (RLS on, no policies); the
-- storefront reads two column-whitelisted views, like the seo_* tables.

CREATE TABLE IF NOT EXISTS public.site_profile (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),

  phone_display text, phone_tel text, whatsapp_number text, email text,

  street_address text, address_locality text, address_region text, postal_code text,
  address_country text NOT NULL DEFAULT 'IN',
  address_lines jsonb NOT NULL DEFAULT '[]'::jsonb,
  area_note text, maps_query text,

  hours_text text, opens text, closes text,
  open_days jsonb NOT NULL DEFAULT '[]'::jsonb,

  instagram_url text, facebook_url text, linkedin_url text, google_profile_url text,
  google_rating numeric(2, 1) CHECK (google_rating IS NULL OR google_rating BETWEEN 0 AND 5),
  google_review_count integer CHECK (google_review_count IS NULL OR google_review_count >= 0),
  google_rating_as_of date,

  grievance_officer_name text, grievance_officer_email text,
  data_protection_name text, data_protection_email text,
  legal_jurisdiction text, retention_text text,
  privacy_updated_on date, terms_updated_on date,

  year_started integer CHECK (year_started IS NULL OR year_started BETWEEN 1990 AND 2100),
  about_story_md text, mission_md text, services_md text, testing_note_md text,
  founder_name text, founder_role text, founder_bio_md text, founder_photo_path text,
  store_photos jsonb NOT NULL DEFAULT '[]'::jsonb,

  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

CREATE TABLE IF NOT EXISTS public.site_team_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  role text,
  bio text,
  photo_path text,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

ALTER TABLE public.site_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_team_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.site_profile, public.site_team_members FROM anon, authenticated;
GRANT ALL ON public.site_profile, public.site_team_members TO service_role;

-- Values the owner has already confirmed (2026-10-13/15). Everything else stays
-- empty for the owner to fill in from Website Admin.
INSERT INTO public.site_profile (
  id, phone_display, phone_tel, whatsapp_number, email,
  street_address, address_locality, address_region, postal_code, address_country,
  address_lines, area_note, maps_query,
  hours_text, opens, closes, open_days,
  instagram_url, facebook_url, linkedin_url, google_profile_url,
  google_rating, google_review_count, google_rating_as_of,
  grievance_officer_name, grievance_officer_email, data_protection_name, data_protection_email,
  legal_jurisdiction, retention_text, privacy_updated_on, terms_updated_on,
  year_started, about_story_md, mission_md, services_md, testing_note_md,
  founder_name, founder_role, founder_bio_md
) VALUES (
  true, '+91 99911 11193', '+919991111193', '919991111193', 'info@digitalbluez.com',
  '9th Floor, T-3 Building, Golden I, Unit No. 915, Plot No. 11, opposite D-Mart, Tech Zone IV',
  'Greater Noida', 'Uttar Pradesh', '201306', 'IN',
  '["9th Floor, T-3 Building, Golden I,", "Unit No. 915, Plot No. 11, opposite D-Mart,", "Tech Zone IV, Greater Noida, Uttar Pradesh 201306"]'::jsonb,
  'Greater Noida West', 'Golden I, Tech Zone IV, Greater Noida West',
  'Every day, 9:00 AM – 8:00 PM', '09:00', '20:00',
  '["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"]'::jsonb,
  'https://www.instagram.com/digitalbluezlaptops/', 'https://www.facebook.com/Digitalbluez',
  'https://www.linkedin.com/company/digitalbluez/', 'https://share.google/VU2Seda0g0eWFF5IV',
  4.9, 97, DATE '2026-07-29',
  'Shishir', 'grievances@digitalbluez.com', 'Akash', 'grievances@digitalbluez.com',
  'Gautam Buddha Nagar, Uttar Pradesh',
  'Invoices and tax records are kept for as long as Indian tax and company law require.',
  DATE '2026-10-15', DATE '2026-10-15',
  2021,
  $a$DigitalBluez (Digitalbluez Technologies Private Limited) sells tested, refurbished laptops and desktops from our store in Tech Zone IV, Greater Noida, and online across India. We stock business-class models from Dell, Lenovo, HP and Apple, so you get a dependable machine at a fraction of the price of a new one.$a$,
  $a$We started DigitalBluez in 2021 with a simple belief: working IT equipment should be reused, not thrown away, and dependable machines should be affordable for individuals, companies and resellers across India.$a$,
  $a$We sell refurbished laptops and desktops. We also repair and upgrade laptops, rent laptops and desktops, and offer annual maintenance.$a$,
  $a$Every laptop is tested and graded by DigitalBluez-trained engineers before it is listed. The checks recorded on a unit's test report include the screen, keyboard, trackpad, battery, ports and connectivity, body condition, boot and operating system, and, where fitted, the camera, audio, WiFi and charging, plus a stress test.$a$,
  'Shishir Chadha', 'Founder',
  $a$An IT director with experience in the United States, Shishir started DigitalBluez to keep good hardware in use, cut e-waste and make affordable IT available across India.$a$
) ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE VIEW public.public_site_profile AS
  SELECT p.phone_display, p.phone_tel, p.whatsapp_number, p.email,
         p.street_address, p.address_locality, p.address_region, p.postal_code, p.address_country,
         p.address_lines, p.area_note, p.maps_query,
         p.hours_text, p.opens, p.closes, p.open_days,
         p.instagram_url, p.facebook_url, p.linkedin_url, p.google_profile_url,
         p.google_rating, p.google_review_count, p.google_rating_as_of,
         p.grievance_officer_name, p.grievance_officer_email, p.data_protection_name, p.data_protection_email,
         p.legal_jurisdiction, p.retention_text, p.privacy_updated_on, p.terms_updated_on,
         p.year_started, p.about_story_md, p.mission_md, p.services_md, p.testing_note_md,
         p.founder_name, p.founder_role, p.founder_bio_md, p.founder_photo_path, p.store_photos,
         b.legal_name, b.gstin
    FROM public.site_profile p
    LEFT JOIN public.business_profiles b ON b.key = 'digitalbluez';

CREATE OR REPLACE VIEW public.public_team_members AS
  SELECT id, name, role, bio, photo_path, sort_order
    FROM public.site_team_members
   WHERE is_active
   ORDER BY sort_order, name;

GRANT SELECT ON public.public_site_profile, public.public_team_members TO anon, authenticated, service_role;
