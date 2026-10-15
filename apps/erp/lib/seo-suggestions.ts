import type { Idea } from '@/lib/seo-competitor-ideas'

// The "what should I do next" engine behind Settings -> Website SEO -> Suggestions.
// buildSuggestions() is a pure function of measured FACTS (gathered by the route),
// so every rule can be tested without a database or a network. A suggestion only
// appears when its condition is really true today; nothing here is a generic tip
// generated from nowhere.

export type Area = 'Google setup' | 'Google Business Profile' | 'Collections' | 'Content' | 'Technical' | 'Keywords' | 'Competitors'
export type Severity = 'high' | 'medium' | 'low'
export type Screen = 'overview' | 'defaults' | 'overrides' | 'collections' | 'keywords' | 'redirects' | 'images' | 'crawl' | 'competitors' | 'google'

export interface Suggestion {
  key: string
  area: Area
  severity: Severity
  title: string
  why: string
  how: string[]
  screen?: Screen
  /** Recurring items come back every N days after being done. */
  everyDays?: number
}

export interface SuggestionState {
  status: 'done' | 'snoozed' | 'dismissed'
  snoozed_until: string | null
  done_at: string | null
  updated_at: string
}

export interface Facts {
  google: {
    homepageFetched: boolean
    gaIdOnSite: string | null
    gaIdLooksValid: boolean
    verificationMetaFound: boolean
    sitemapOk: boolean
    gscConfigured: boolean
    ga4Configured: boolean
  }
  /** Brands with their available (in-stock) laptop/desktop counts. */
  stockByBrand: { brand: string; available: number }[]
  /** Price bands: how many available machines cost at most `max`. */
  priceBands: { max: number; available: number }[]
  collections: { slug: string; name: string; status: string; indexable: boolean; reason: string; brands: string[]; maxPrice: number | null }[]
  publishedWithoutDescription: number
  imagesWithoutAlt: number
  notFound: { path: string; hits: number; hasRedirect: boolean }[]
  crawl: { importedAt: string; errors: number; warnings: number } | null
  keywords: {
    total: number
    withoutTarget: number
    clusterConflicts: string[]
    striking: { keyword: string; position: number; impressions: number; target: string }[]
    lowCtr: { keyword: string; position: number; ctrPct: number }[]
  }
  newArrivals: string[]
  competitorIdeas: { site: string; idea: Idea }[]
}

const SEV: Record<Severity, number> = { high: 0, medium: 1, low: 2 }
const DAY = 24 * 60 * 60 * 1000

// ----------------------------------------------------------------- Google Business Profile
// Reminders only: this tool cannot read or edit a Business Profile. Each step is
// something the owner does in Google's own interface.
export function gbpChecklist(newArrivals: string[]): Suggestion[] {
  const arrivals = newArrivals.slice(0, 3)
  return [
    {
      key: 'gbp:post-new-arrivals', area: 'Google Business Profile', severity: 'medium', everyDays: 7,
      title: 'Post this week\'s new arrivals on your Google Business Profile',
      why: 'Fresh posts and photos show Google (and shoppers) that the business is active, and they put real stock in front of people searching nearby.',
      how: [
        'Open your Business Profile → Add update.',
        arrivals.length ? `Post 2–3 real photos of this week's arrivals, for example: ${arrivals.join('; ')}.` : 'Post 2–3 real photos of laptops you tested this week.',
        'Add the price, a line on the warranty, and a WhatsApp or Call button. Link to the matching page on the website.',
      ],
      screen: 'collections',
    },
    {
      key: 'gbp:reply-reviews', area: 'Google Business Profile', severity: 'medium', everyDays: 7,
      title: 'Reply to every new Google review',
      why: 'Replies are public and show future customers how you treat people. Quick, specific replies build trust.',
      how: ['Open Reviews on your Business Profile.', 'Thank each reviewer and mention something specific. For a complaint, apologise, say what you will do, and invite them to contact you.', 'Never offer a discount or gift in return for a review.'],
    },
    {
      key: 'gbp:photos', area: 'Google Business Profile', severity: 'low', everyDays: 30,
      title: 'Add at least 5 new real photos',
      why: 'Profiles with recent, real photos earn more trust. Real photos of your store, team and testing bench are something marketplaces cannot copy.',
      how: ['Photograph the storefront, the testing bench, a laptop being tested, packaging and the team.', 'Upload under Photos on your Business Profile, and use the same ones on the About page (Website Admin → Company & About).', 'Use real photos only.'],
    },
    {
      key: 'gbp:hours', area: 'Google Business Profile', severity: 'low', everyDays: 30,
      title: 'Check opening hours and set holiday hours',
      why: 'Wrong hours cost visits and reviews. Special hours stop customers arriving at a closed shop.',
      how: ['Confirm the hours match your website (Website Admin → Company & About).', 'Add special hours for upcoming festivals or closures.'],
    },
    {
      key: 'gbp:services', area: 'Google Business Profile', severity: 'low', everyDays: 30,
      title: 'Refresh services and products on the profile',
      why: 'The services and products you list help Google match you to searches such as "laptop repair" or "laptop on rent".',
      how: ['List only services you really offer (sales, repair and upgrade, rental, annual maintenance).', 'Add products with a photo, price and link for your best sellers.'],
    },
    {
      key: 'gbp:insights', area: 'Google Business Profile', severity: 'low', everyDays: 30,
      title: 'Review the profile\'s performance numbers',
      why: 'Calls, direction requests and the searches that found you show what is working locally.',
      how: ['Open Performance on your Business Profile.', 'Note calls, direction requests and the top search terms, and compare with last month.'],
      screen: 'keywords',
    },
    {
      key: 'gbp:category-attrs', area: 'Google Business Profile', severity: 'low', everyDays: 90,
      title: 'Check the primary category and attributes',
      why: 'The primary category is one of the strongest signals for which searches you appear in.',
      how: ['Pick the primary category that best matches what most customers look for, and add secondary ones for repair or rental if you offer them.', 'Fill in every attribute that applies.'],
    },
    {
      key: 'gbp:nap', area: 'Google Business Profile', severity: 'low', everyDays: 90,
      title: 'Check name, address and phone match everywhere',
      why: 'Google trusts a business more when its name, address and phone are identical on the website, the profile and directories.',
      how: ['Compare the profile with the website footer, Mappls, Justdial, IndiaMART, Facebook, Instagram and LinkedIn.', 'Correct any listing that differs. The exact text to use is in Website Admin → Company & About.'],
    },
    {
      key: 'gbp:utm', area: 'Google Business Profile', severity: 'low', everyDays: 90,
      title: 'Tag the website link on your profile',
      why: 'Without a tag, visits from your Business Profile are mixed into other traffic in Google Analytics.',
      how: ['Set the profile\'s website link to https://www.digitalbluez.com/?utm_source=google&utm_medium=organic&utm_campaign=business_profile.', 'Check in Google Analytics that these visits appear.'],
    },
  ]
}

// ----------------------------------------------------------------- rule-based suggestions
export function ruleSuggestions(f: Facts, now: Date = new Date()): Suggestion[] {
  const out: Suggestion[] = []
  const add = (s: Suggestion) => out.push(s)

  // 1. Google setup
  if (!f.google.homepageFetched) {
    add({ key: 'google:site-unreachable', area: 'Google setup', severity: 'medium', title: 'The live website could not be checked', why: 'The Google setup checks read your public home page. It did not respond just now, so tags could not be verified.', how: ['Open the website in a browser. If it loads, run the check again in a few minutes.'], screen: 'google' })
  } else {
    if (!f.google.gaIdOnSite) {
      add({ key: 'google:ga-missing', area: 'Google setup', severity: 'high', title: 'Google Analytics is not installed on the live site', why: 'No Google Analytics tag was found on the home page, so visits, sources and sales are not being measured.', how: ['Set NEXT_PUBLIC_GA_MEASUREMENT_ID in the storefront Vercel project to your 10-character GA4 ID (G-XXXXXXXXXX) and redeploy.'], screen: 'google' })
    } else if (!f.google.gaIdLooksValid) {
      add({ key: 'google:ga-id-invalid', area: 'Google setup', severity: 'high', title: `The Analytics ID on the live site (${f.google.gaIdOnSite}) looks wrong`, why: 'A GA4 measurement ID is "G-" followed by 10 letters or digits. A shortened ID sends every visit to a property that does not exist, so the data is lost silently.', how: ['Copy the exact ID from Google Analytics → Admin → Data streams.', 'Set NEXT_PUBLIC_GA_MEASUREMENT_ID in the storefront Vercel project and redeploy.', 'Open the site, then check Google Analytics → Realtime shows you.'], screen: 'google' })
    }
    if (!f.google.verificationMetaFound) {
      add({ key: 'google:gsc-verify', area: 'Google setup', severity: 'medium', title: 'Confirm Google Search Console is verified', why: 'No Search Console verification tag or file was found on the site. That is fine if you verified the domain with a DNS record, but if you have not verified at all, Google gives you no indexing data.', how: ['In Search Console, add the site as a Domain property and verify with the DNS TXT record Google shows (no code change needed).', 'Then submit https://www.digitalbluez.com/sitemap.xml.'], screen: 'google' })
    }
  }
  if (!f.google.sitemapOk) {
    add({ key: 'google:sitemap', area: 'Google setup', severity: 'high', title: 'The sitemap could not be read', why: 'Google finds new pages through sitemap.xml.', how: ['Open https://www.digitalbluez.com/sitemap.xml. If it fails, investigate before submitting it.'], screen: 'google' })
  }
  if (!f.google.gscConfigured || !f.google.ga4Configured) {
    add({ key: 'google:reports', area: 'Google setup', severity: 'medium', title: 'Connect Search Console and Analytics reports to the ERP', why: 'Without them this screen cannot show real queries, clicks or traffic, and the ranking suggestions below stay empty.', how: ['Follow the numbered steps on the Google setup screen: add the service account to both properties and set GSC_SITE_URL and GA4_PROPERTY_ID.'], screen: 'google' })
  }

  // 2. Collections: opportunities and problems
  const covered = new Set(f.collections.flatMap((c) => c.brands.map((b) => b.toLowerCase())))
  for (const b of f.stockByBrand.filter((x) => x.available >= 3 && x.brand).sort((a, b) => b.available - a.available)) {
    if (covered.has(b.brand.toLowerCase())) continue
    add({ key: `collections:brand:${b.brand.toLowerCase()}`, area: 'Collections', severity: 'medium', title: `Create a ${b.brand} collection page`, why: `You have ${b.available} ${b.brand} laptops/desktops in stock and no ${b.brand} page. People search by brand ("refurbished ${b.brand.toLowerCase()} laptop") and a page with your own introduction can rank for it.`, how: [`In Collections, add a ${b.brand} collection filtered to brand ${b.brand}.`, 'Write an introduction of at least 120 words from what you actually see: which models, what they suit, what you check.'], screen: 'collections' })
  }
  const bandMaxes = new Set(f.collections.map((c) => c.maxPrice).filter((n): n is number => n != null))
  // At most two at a time (the best-stocked bands), so this never becomes a wall of near-identical items.
  const bands = f.priceBands.filter((x) => x.available >= 3 && !bandMaxes.has(x.max)).sort((x, y) => y.available - x.available).slice(0, 2)
  for (const band of bands) {
    add({ key: `collections:band:${band.max}`, area: 'Collections', severity: 'low', title: `Create an "under ₹${band.max.toLocaleString('en-IN')}" page`, why: `${band.available} machines are available at that price or below, and shoppers search by budget.`, how: [`In Collections, add a Budget collection with a maximum price of ₹${band.max.toLocaleString('en-IN')} and write its introduction.`], screen: 'collections' })
  }
  for (const c of f.collections.filter((x) => x.status === 'published' && !x.indexable)) {
    add({ key: `collections:gate:${c.slug}`, area: 'Collections', severity: 'medium', title: `"${c.name}" is published but hidden from Google`, why: `It does not pass its quality gate: ${c.reason}.`, how: ['Open the collection to see which condition is failing.', 'Add stock, lengthen the introduction with original text, or accept that it stays hidden until it qualifies.'], screen: 'collections' })
  }
  const drafts = f.collections.filter((x) => x.status === 'draft')
  if (drafts.length) {
    add({ key: 'collections:drafts', area: 'Collections', severity: 'medium', title: `${drafts.length} collection draft${drafts.length === 1 ? ' is' : 's are'} waiting to be reviewed`, why: 'Drafts are invisible to customers and to Google. Each one that qualifies is a new page that can bring search visitors.', how: ['Read each draft introduction, correct anything that is not true of your stock, and publish.'], screen: 'collections' })
  }

  // 3. Content
  if (f.publishedWithoutDescription > 0) {
    add({ key: 'content:descriptions', area: 'Content', severity: 'medium', title: `${f.publishedWithoutDescription} published product${f.publishedWithoutDescription === 1 ? ' has' : 's have'} no description of its own`, why: 'They fall back to the generic template, which reads the same on every such product.', how: ['Open SKU Master → Website for each and write 2–3 sentences about that exact unit.'] })
  }
  if (f.imagesWithoutAlt > 0) {
    add({ key: 'content:alt', area: 'Content', severity: 'low', title: `${f.imagesWithoutAlt} photo${f.imagesWithoutAlt === 1 ? ' has' : 's have'} no description`, why: 'Alt text lets screen-reader users and Google Images understand the photo.', how: ['Use "Fill all missing with a default", then improve the ones that matter.'], screen: 'images' })
  }

  // 4. Technical
  for (const n of f.notFound.filter((x) => x.hits >= 3 && !x.hasRedirect).sort((a, b) => b.hits - a.hits).slice(0, 5)) {
    add({ key: `tech:404:${n.path}`, area: 'Technical', severity: n.hits >= 10 ? 'high' : 'medium', title: `${n.path} is being requested but does not exist (${n.hits} times)`, why: 'Visitors (and links pointing at the site) are hitting a dead end.', how: ['If a similar page exists, add a redirect to it. If it was never real, mark it done.'], screen: 'redirects' })
  }
  if (!f.crawl) {
    add({ key: 'tech:crawl-never', area: 'Technical', severity: 'medium', title: 'Run your first site crawl', why: 'A crawl finds broken links, missing titles and duplicate pages that are invisible from the shop floor.', how: ['Follow the steps on Crawl & 404s (Screaming Frog is free for sites under 500 pages) and upload the export.'], screen: 'crawl' })
  } else {
    const age = (now.getTime() - new Date(f.crawl.importedAt).getTime()) / DAY
    if (age > 35) add({ key: 'tech:crawl-stale', area: 'Technical', severity: 'low', title: `The last crawl is ${Math.round(age)} days old`, why: 'New products and pages can add broken links or missing titles between crawls.', how: ['Re-run the crawl and upload the new export.'], screen: 'crawl' })
    if (f.crawl.errors > 0) add({ key: 'tech:crawl-errors', area: 'Technical', severity: 'high', title: `${f.crawl.errors} problem${f.crawl.errors === 1 ? '' : 's'} to fix from the last crawl`, why: 'These are broken pages, missing titles or headings, and similar issues.', how: ['Open Crawl & 404s and work through the "FIX" items first.'], screen: 'crawl' })
  }

  // 5. Keywords
  if (f.keywords.withoutTarget > 0) {
    add({ key: 'keywords:no-target', area: 'Keywords', severity: 'low', title: `${f.keywords.withoutTarget} keyword${f.keywords.withoutTarget === 1 ? ' has' : 's have'} no target page`, why: 'Each phrase needs one page that should rank for it, or it has no owner.', how: ['Assign the best existing page, or create one.'], screen: 'keywords' })
  }
  for (const c of f.keywords.clusterConflicts.slice(0, 3)) {
    add({ key: `keywords:conflict:${c}`, area: 'Keywords', severity: 'medium', title: `"${c}" is aimed at more than one page`, why: 'Two of your pages competing for the same phrase can both rank worse than one strong page.', how: ['Choose one page for this cluster and point the others elsewhere, or differentiate them.'], screen: 'keywords' })
  }
  for (const k of f.keywords.striking.slice(0, 5)) {
    add({ key: `keywords:striking:${k.keyword}`, area: 'Keywords', severity: 'medium', title: `"${k.keyword}" is on the edge of page 1 (position ${k.position.toFixed(1)})`, why: `${k.impressions} impressions at an average position of ${k.position.toFixed(1)}. A small improvement to ${k.target} could move it onto page 1.`, how: [`Add the phrase naturally to ${k.target}'s title, heading and introduction, and link to it from related pages.`], screen: 'overrides' })
  }
  for (const k of f.keywords.lowCtr.slice(0, 5)) {
    add({ key: `keywords:ctr:${k.keyword}`, area: 'Keywords', severity: 'medium', title: `"${k.keyword}" ranks well but few people click (${k.ctrPct.toFixed(1)}%)`, why: `Position ${k.position.toFixed(1)} should earn more clicks. The title or description is probably not persuasive.`, how: ['Rewrite the search title and description for the target page (Page metadata).'], screen: 'overrides' })
  }

  // 6. Competitor ideas: the top few, one per area
  const seenAreas = new Set<string>()
  for (const { site, idea } of f.competitorIdeas) {
    if (seenAreas.has(idea.area)) continue
    seenAreas.add(idea.area)
    add({ key: `competitor:${idea.key}`, area: 'Competitors', severity: 'low', title: `${idea.title} (seen on ${site})`, why: idea.evidence, how: [idea.apply], screen: 'competitors' })
    if (seenAreas.size >= 4) break
  }

  return out
}

// ----------------------------------------------------------------- state: done / snoozed / dismissed
const RECHECK_DONE_DAYS = 14 // a "done" rule-based item is re-checked after this long
const DISMISS_DAYS = 90

export function applyState(all: Suggestion[], state: Record<string, SuggestionState | undefined>, now: Date = new Date()): { active: Suggestion[]; hidden: number } {
  const active: Suggestion[] = []
  let hidden = 0
  for (const s of all) {
    const st = state[s.key]
    let show = true
    if (st) {
      const doneAt = st.done_at ? new Date(st.done_at).getTime() : null
      if (st.status === 'snoozed') show = !(st.snoozed_until && new Date(st.snoozed_until).getTime() > now.getTime())
      else if (st.status === 'done') {
        const window = (s.everyDays ?? RECHECK_DONE_DAYS) * DAY
        show = doneAt == null || now.getTime() - doneAt >= window
      } else if (st.status === 'dismissed') {
        // Hidden for a while (a recurring item: until its next cycle), then offered again.
        const window = (s.everyDays ?? DISMISS_DAYS) * DAY
        show = now.getTime() - new Date(st.updated_at).getTime() >= window
      }
    }
    if (show) active.push(s)
    else hidden++
  }
  active.sort((a, b) => SEV[a.severity] - SEV[b.severity] || a.area.localeCompare(b.area) || a.title.localeCompare(b.title))
  return { active, hidden }
}

export function buildSuggestions(f: Facts, state: Record<string, SuggestionState | undefined>, now: Date = new Date()) {
  return applyState([...ruleSuggestions(f, now), ...gbpChecklist(f.newArrivals)], state, now)
}

// A GA4 measurement ID is "G-" followed by 10 letters/digits.
export const GA_ID_PATTERN = /^G-[A-Z0-9]{10}$/
