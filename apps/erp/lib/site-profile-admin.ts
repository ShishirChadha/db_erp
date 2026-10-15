// Validation for the owner-managed company profile (Settings -> Website Admin ->
// Company & About). Only keys present in the request are validated and written,
// so each group of fields in the UI can be saved on its own. null / '' clears a
// field. Everything here ends up on the public website, so values are length-
// capped and URLs must be https.

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
// Photos are uploaded through /api/storage/upload-image into the site/ folder.
const PHOTO_PATH = /^site\/[A-Za-z0-9._\/-]{1,200}$/

type Rule = (v: unknown) => { ok: true; value: unknown } | { ok: false; error: string }

const text = (label: string, max: number): Rule => (v) => {
  if (v === null || v === undefined) return { ok: true, value: null }
  const s = String(v).trim()
  if (s.length > max) return { ok: false, error: `${label} is over ${max} characters` }
  return { ok: true, value: s === '' ? null : s }
}
const pattern = (label: string, re: RegExp, hint: string, max = 100): Rule => (v) => {
  const t = text(label, max)(v)
  if (!t.ok || t.value === null) return t
  return re.test(t.value as string) ? t : { ok: false, error: `${label}: ${hint}` }
}
const url = (label: string): Rule => pattern(label, /^https:\/\/[^\s]+$/, 'must start with https://', 300)
const email = (label: string): Rule => pattern(label, EMAIL, 'is not a valid email address', 254)
const date = (label: string): Rule => pattern(label, ISO_DATE, 'use the date picker (YYYY-MM-DD)', 10)
const photo = (label: string): Rule => pattern(label, PHOTO_PATH, 'must be a photo uploaded here', 220)

const integer = (label: string, min: number, max: number): Rule => (v) => {
  if (v === null || v === undefined || v === '') return { ok: true, value: null }
  const n = Number(v)
  if (!Number.isInteger(n) || n < min || n > max) return { ok: false, error: `${label} must be a whole number from ${min} to ${max}` }
  return { ok: true, value: n }
}

const RULES: Record<string, Rule> = {
  phone_display: text('Phone (as shown)', 30),
  phone_tel: pattern('Phone (dialling)', /^\+?[0-9]{8,15}$/, 'digits only, e.g. +919991111193', 20),
  whatsapp_number: pattern('WhatsApp number', /^[0-9]{8,15}$/, 'digits only with country code, e.g. 919991111193', 20),
  email: email('Email'),

  street_address: text('Street address', 200),
  address_locality: text('City', 80),
  address_region: text('State', 80),
  postal_code: pattern('Postal code', /^[0-9A-Za-z -]{3,10}$/, 'looks wrong', 10),
  address_country: pattern('Country code', /^[A-Z]{2}$/, 'two capital letters, e.g. IN', 2),
  area_note: text('Area note', 60),
  maps_query: text('Map search', 200),

  hours_text: text('Opening hours (as shown)', 80),
  opens: pattern('Opens', TIME, 'use 24-hour HH:MM, e.g. 09:00', 5),
  closes: pattern('Closes', TIME, 'use 24-hour HH:MM, e.g. 20:00', 5),

  instagram_url: url('Instagram'),
  facebook_url: url('Facebook'),
  linkedin_url: url('LinkedIn'),
  google_profile_url: url('Google Business Profile link'),
  google_review_count: integer('Review count', 0, 1_000_000),
  google_rating_as_of: date('Rating date'),

  grievance_officer_name: text('Grievance Officer name', 80),
  grievance_officer_email: email('Grievance Officer email'),
  data_protection_name: text('Data protection contact name', 80),
  data_protection_email: email('Data protection email'),
  legal_jurisdiction: text('Court jurisdiction', 120),
  retention_text: text('Record retention wording', 400),
  privacy_updated_on: date('Privacy policy date'),
  terms_updated_on: date('Terms date'),

  year_started: integer('Year started', 1990, new Date().getFullYear() + 1),
  about_story_md: text('About story', 4000),
  mission_md: text('Mission', 2000),
  services_md: text('Services', 2000),
  testing_note_md: text('How we test', 2000),
  founder_name: text('Founder name', 80),
  founder_role: text('Founder role', 80),
  founder_bio_md: text('Founder bio', 2000),
  founder_photo_path: photo('Founder photo'),
}

export function validateSiteProfile(body: Record<string, unknown>):
  | { ok: true; update: Record<string, unknown> }
  | { ok: false; error: string } {
  const update: Record<string, unknown> = {}

  for (const [key, rule] of Object.entries(RULES)) {
    if (!(key in body)) continue
    const r = rule(body[key])
    if (!r.ok) return { ok: false, error: r.error }
    update[key] = r.value
  }

  if ('google_rating' in body) {
    const v = body.google_rating
    if (v === null || v === '' || v === undefined) update.google_rating = null
    else {
      const n = Number(v)
      if (!Number.isFinite(n) || n < 0 || n > 5) return { ok: false, error: 'Rating must be between 0 and 5' }
      update.google_rating = Math.round(n * 10) / 10
    }
  }

  if ('address_lines' in body) {
    const lines = body.address_lines
    if (!Array.isArray(lines) || lines.length > 5 || lines.some((l) => typeof l !== 'string' || l.length > 120)) {
      return { ok: false, error: 'Address lines: up to 5 lines of at most 120 characters' }
    }
    update.address_lines = lines.map((l: string) => l.trim()).filter(Boolean)
  }

  if ('open_days' in body) {
    const days = body.open_days
    if (!Array.isArray(days) || days.some((d) => !DAYS.includes(d))) return { ok: false, error: 'Open days must be weekday names' }
    update.open_days = DAYS.filter((d) => (days as string[]).includes(d))
  }

  if ('store_photos' in body) {
    const photos = body.store_photos
    if (!Array.isArray(photos) || photos.length > 12) return { ok: false, error: 'At most 12 store photos' }
    const clean: { path: string; alt: string; caption?: string }[] = []
    for (const p of photos as any[]) {
      if (!p || typeof p.path !== 'string' || !PHOTO_PATH.test(p.path)) return { ok: false, error: 'A store photo has an invalid path' }
      const alt = String(p.alt ?? '').trim()
      if (!alt || alt.length > 150) return { ok: false, error: 'Every store photo needs a short description (alt text, max 150 characters)' }
      const caption = String(p.caption ?? '').trim()
      if (caption.length > 150) return { ok: false, error: 'Photo captions are limited to 150 characters' }
      clean.push({ path: p.path, alt, ...(caption ? { caption } : {}) })
    }
    update.store_photos = clean
  }

  // Opening hours must be coherent: times only make sense together.
  const times = ['opens', 'closes'].filter((k) => k in update)
  if (times.length === 1 && update[times[0]] !== null) {
    return { ok: false, error: 'Set both the opening and closing time together' }
  }

  return { ok: true, update }
}

export function validateTeamMember(body: Record<string, unknown>):
  | { ok: true; row: Record<string, unknown> }
  | { ok: false; error: string } {
  const name = text('Name', 80)(body.name)
  if (!name.ok) return name
  if (!name.value) return { ok: false, error: 'Name is required' }
  const role = text('Role', 80)(body.role)
  if (!role.ok) return role
  const bio = text('Bio', 400)(body.bio)
  if (!bio.ok) return bio
  const ph = photo('Photo')(body.photo_path)
  if (!ph.ok) return ph
  const order = integer('Order', 0, 1000)(body.sort_order)
  if (!order.ok) return order
  return {
    ok: true,
    row: {
      name: name.value,
      role: role.value,
      bio: bio.value,
      photo_path: ph.value,
      sort_order: order.value ?? 0,
      is_active: body.is_active === undefined ? true : !!body.is_active,
    },
  }
}
