import { cache } from 'react'
import { createPublicSupabaseClient } from '@db/db/public'
import * as fallback from '@/lib/business-info'

// The storefront's single source for company contact details, hours, legal
// contacts and About-page content: the owner-managed `site_profile` row (ERP:
// Settings -> Website Admin -> Company & About), read through the
// `public_site_profile` view. `lib/business-info.ts` is now only the FALLBACK
// used if that row is missing or the read fails, so a hiccup here can never
// blank the footer, contact page or structured data.

export interface StorePhoto { path: string; alt: string; caption?: string }
export interface TeamMember { id: string; name: string; role: string | null; bio: string | null; photo_path: string | null }

export interface SiteProfile {
  businessName: string
  legalName: string | null
  gstin: string | null
  phoneDisplay: string
  phoneTel: string
  whatsappNumber: string
  email: string
  addressLines: string[]
  addressSingleLine: string
  postalAddress: {
    '@type': 'PostalAddress'
    streetAddress: string
    addressLocality: string
    addressRegion: string
    postalCode: string
    addressCountry: string
  }
  areaNote: string | null
  mapsEmbedSrc: string
  hoursText: string | null
  openingHoursSpec: Record<string, unknown> | null
  social: { instagram: string | null; facebook: string | null; linkedin: string | null }
  sameAs: string[]
  googleProfileUrl: string
  googleRating: number | null
  googleReviewCount: number | null
  googleRatingAsOf: string | null
  grievance: { name: string; email: string }
  dataProtection: { name: string; email: string }
  legalJurisdiction: string
  retentionText: string
  privacyUpdatedOn: string | null
  termsUpdatedOn: string | null
  yearStarted: number | null
  aboutStoryMd: string | null
  missionMd: string | null
  servicesMd: string | null
  testingNoteMd: string | null
  founder: { name: string | null; role: string | null; bioMd: string | null; photoPath: string | null }
  storePhotos: StorePhoto[]
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

const FALLBACK_JURISDICTION = 'Gautam Buddha Nagar, Uttar Pradesh'
const FALLBACK_RETENTION = 'Invoices and tax records are kept for as long as Indian tax and company law require.'

function fromFallback(): SiteProfile {
  return {
    businessName: fallback.BUSINESS_NAME,
    legalName: null,
    gstin: null,
    phoneDisplay: fallback.BUSINESS_PHONE_DISPLAY,
    phoneTel: fallback.BUSINESS_PHONE_TEL,
    whatsappNumber: fallback.WHATSAPP_NUMBER,
    email: fallback.BUSINESS_EMAIL,
    addressLines: fallback.BUSINESS_ADDRESS_LINES,
    addressSingleLine: fallback.BUSINESS_ADDRESS_SINGLE_LINE,
    postalAddress: { ...fallback.BUSINESS_POSTAL_ADDRESS },
    areaNote: 'Greater Noida West',
    mapsEmbedSrc: fallback.GOOGLE_MAPS_EMBED_SRC,
    hoursText: fallback.BUSINESS_HOURS_TEXT,
    openingHoursSpec: { ...fallback.BUSINESS_OPENING_HOURS_SPEC },
    social: { ...fallback.SOCIAL_LINKS },
    sameAs: Object.values(fallback.SOCIAL_LINKS),
    googleProfileUrl: fallback.GOOGLE_PROFILE_URL,
    googleRating: fallback.GOOGLE_RATING,
    googleReviewCount: fallback.GOOGLE_REVIEW_COUNT,
    googleRatingAsOf: null,
    grievance: { ...fallback.GRIEVANCE_OFFICER },
    dataProtection: { ...fallback.GRIEVANCE_OFFICER },
    legalJurisdiction: FALLBACK_JURISDICTION,
    retentionText: FALLBACK_RETENTION,
    privacyUpdatedOn: null,
    termsUpdatedOn: null,
    yearStarted: null,
    aboutStoryMd: null,
    missionMd: null,
    servicesMd: null,
    testingNoteMd: null,
    founder: { name: null, role: null, bioMd: null, photoPath: null },
    storePhotos: [],
  }
}

function mapsEmbed(query: string): string {
  return `https://maps.google.com/maps?q=${encodeURIComponent(query)}&t=m&z=15&output=embed&iwloc=near`
}

export const getSiteProfile = cache(async (): Promise<SiteProfile> => {
  const base = fromFallback()
  try {
    const supabase = createPublicSupabaseClient()
    const { data } = await supabase.from('public_site_profile').select('*').maybeSingle()
    if (!data) return base
    const r = data as Record<string, any>

    const lines: string[] = Array.isArray(r.address_lines) ? r.address_lines.filter((x: unknown) => typeof x === 'string' && x.trim()) : []
    const addressLines = lines.length ? lines : base.addressLines
    const days: string[] = Array.isArray(r.open_days) ? r.open_days : []
    const social = {
      instagram: str(r.instagram_url) ?? base.social.instagram,
      facebook: str(r.facebook_url) ?? base.social.facebook,
      linkedin: str(r.linkedin_url) ?? base.social.linkedin,
    }
    const photos: StorePhoto[] = Array.isArray(r.store_photos)
      ? r.store_photos.filter((p: any) => p && typeof p.path === 'string' && p.path).map((p: any) => ({ path: p.path, alt: str(p.alt) ?? 'DigitalBluez store', caption: str(p.caption) ?? undefined }))
      : []

    return {
      businessName: base.businessName,
      legalName: str(r.legal_name),
      gstin: str(r.gstin),
      phoneDisplay: str(r.phone_display) ?? base.phoneDisplay,
      phoneTel: str(r.phone_tel) ?? base.phoneTel,
      whatsappNumber: str(r.whatsapp_number) ?? base.whatsappNumber,
      email: str(r.email) ?? base.email,
      addressLines,
      addressSingleLine: str(r.street_address)
        ? [r.street_address, r.address_locality, [r.address_region, r.postal_code].filter(Boolean).join(' ')].filter(Boolean).join(', ')
        : addressLines.join(' ').replace(/,\s*$/, ''),
      postalAddress: {
        '@type': 'PostalAddress',
        streetAddress: str(r.street_address) ?? base.postalAddress.streetAddress,
        addressLocality: str(r.address_locality) ?? base.postalAddress.addressLocality,
        addressRegion: str(r.address_region) ?? base.postalAddress.addressRegion,
        postalCode: str(r.postal_code) ?? base.postalAddress.postalCode,
        addressCountry: str(r.address_country) ?? base.postalAddress.addressCountry,
      },
      areaNote: str(r.area_note),
      mapsEmbedSrc: str(r.maps_query) ? mapsEmbed(r.maps_query) : base.mapsEmbedSrc,
      hoursText: str(r.hours_text),
      openingHoursSpec:
        days.length && str(r.opens) && str(r.closes)
          ? { '@type': 'OpeningHoursSpecification', dayOfWeek: days, opens: r.opens, closes: r.closes }
          : null,
      social,
      sameAs: Object.values(social).filter((v): v is string => !!v),
      googleProfileUrl: str(r.google_profile_url) ?? base.googleProfileUrl,
      googleRating: typeof r.google_rating === 'number' ? r.google_rating : r.google_rating != null ? Number(r.google_rating) : null,
      googleReviewCount: typeof r.google_review_count === 'number' ? r.google_review_count : null,
      googleRatingAsOf: str(r.google_rating_as_of),
      grievance: { name: str(r.grievance_officer_name) ?? base.grievance.name, email: str(r.grievance_officer_email) ?? base.grievance.email },
      dataProtection: { name: str(r.data_protection_name) ?? base.dataProtection.name, email: str(r.data_protection_email) ?? base.dataProtection.email },
      legalJurisdiction: str(r.legal_jurisdiction) ?? base.legalJurisdiction,
      retentionText: str(r.retention_text) ?? base.retentionText,
      privacyUpdatedOn: str(r.privacy_updated_on),
      termsUpdatedOn: str(r.terms_updated_on),
      yearStarted: typeof r.year_started === 'number' ? r.year_started : null,
      aboutStoryMd: str(r.about_story_md),
      missionMd: str(r.mission_md),
      servicesMd: str(r.services_md),
      testingNoteMd: str(r.testing_note_md),
      founder: { name: str(r.founder_name), role: str(r.founder_role), bioMd: str(r.founder_bio_md), photoPath: str(r.founder_photo_path) },
      storePhotos: photos,
    }
  } catch {
    return base
  }
})

export const getTeamMembers = cache(async (): Promise<TeamMember[]> => {
  try {
    const supabase = createPublicSupabaseClient()
    const { data } = await supabase.from('public_team_members').select('id, name, role, bio, photo_path')
    return (data ?? []) as TeamMember[]
  } catch {
    return []
  }
})

export function whatsappLink(profile: Pick<SiteProfile, 'whatsappNumber'>, message?: string): string {
  return `https://wa.me/${profile.whatsappNumber}${message ? `?text=${encodeURIComponent(message)}` : ''}`
}

// "9 April 2026" for a stored ISO date; null stays null.
export function formatLongDate(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(`${iso}T00:00:00Z`)
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
}
