import type { PageSignals, SiteSignals } from '@/lib/seo-competitor'

// Turns two analyses -- ours and a competitor's -- into STRUCTURAL ideas ("they
// have budget pages and we don't"), each tied to the screen where it is applied.
// It never proposes copying their wording; the evidence is only what they were
// seen doing. Whether a claim or feature is right for DigitalBluez stays the
// owner's call, and every idea says so where it matters.

export type IdeaScreen = 'collections' | 'overrides' | 'keywords' | 'defaults' | 'images' | 'redirects'
export interface Idea {
  key: string
  area: 'Collections' | 'Schema' | 'Page metadata' | 'Policies' | 'Content' | 'Trust'
  title: string
  evidence: string
  apply: string
  screen?: IdeaScreen
}

const names = (links: { text: string }[], max = 5) => links.slice(0, max).map((l) => l.text || '—').join(', ')
const allPages = (s: SiteSignals): PageSignals[] => Object.values(s.pages).filter((p): p is PageSignals => !!p)
const schemaTypes = (s: SiteSignals) => new Set(allPages(s).flatMap((p) => p.schemaTypes))
const brandWords = (s: SiteSignals) => new Set(s.nav.brand.map((l) => l.text.toLowerCase().match(/dell|hp|lenovo|apple|macbook|acer|asus|msi|samsung|microsoft|surface/)?.[0]).filter((x): x is string => !!x))

export function buildCompetitorIdeas(self: SiteSignals | null, other: SiteSignals, label: string): Idea[] {
  const ideas: Idea[] = []
  const add = (i: Idea) => ideas.push(i)
  const ourCollections = self?.sitemap.buckets.collection ?? 0

  // 1. Budget / brand / use-case entry pages
  if (other.nav.budget.length >= 2) {
    add({
      key: `collections-budget:${label}`,
      area: 'Collections',
      title: 'Budget-band pages ("under ₹X")',
      evidence: `${label} links ${other.nav.budget.length} price-band pages from its menu: ${names(other.nav.budget)}.`,
      apply: 'Create "Under ₹X" collections for each price band where you have at least 3 laptops in stock. Write the intro yourself.',
      screen: 'collections',
    })
  }
  const theirBrands = brandWords(other)
  const ourBrands = self ? brandWords(self) : new Set<string>()
  const missingBrands = [...theirBrands].filter((b) => !ourBrands.has(b))
  if (missingBrands.length) {
    add({
      key: `collections-brand:${label}`,
      area: 'Collections',
      title: 'Brand pages in the main menu',
      evidence: `${label} gives these brands their own menu entry: ${missingBrands.join(', ')}. Our home page links none of them.`,
      apply: 'Publish brand collections for brands with at least 3 units in stock, and link them from the category pages ("Shop by").',
      screen: 'collections',
    })
  }
  if (other.nav.useCase.length && !(self?.nav.useCase.length)) {
    add({
      key: `collections-usecase:${label}`,
      area: 'Collections',
      title: 'Pages for who the laptop is for',
      evidence: `${label} has use-case pages: ${names(other.nav.useCase)}.`,
      apply: 'Create "use case" collections (students, office, coding) defined by RAM, processor and price, with copy that explains what to look for.',
      screen: 'collections',
    })
  }
  if (other.sitemap.buckets.collection > Math.max(ourCollections * 2, 5)) {
    add({
      key: `collections-count:${label}`,
      area: 'Collections',
      title: 'Number of category / collection pages',
      evidence: `${label}'s sitemap lists ${other.sitemap.buckets.collection}${other.sitemap.indexed ? '+' : ''} collection or category pages; ours lists ${ourCollections}.`,
      apply: 'Grow collections steadily, only where there is real stock and original text. Do not create pages for every filter combination.',
      screen: 'collections',
    })
  }

  // 2. Structured data on product pages
  const op = other.pages.product?.product
  const sp = self?.pages.product?.product ?? null
  if (op) {
    const gaps: [boolean, string][] = [
      [op.hasShippingDetails && !sp?.hasShippingDetails, 'shipping details'],
      [op.hasReturnPolicy && !sp?.hasReturnPolicy, 'a return / replacement policy'],
      [op.hasPriceValidUntil && !sp?.hasPriceValidUntil, 'a price-valid-until date'],
      [op.hasGtinOrMpn && !sp?.hasGtinOrMpn, 'a product identifier (GTIN / MPN)'],
    ]
    const missing = gaps.filter(([g]) => g).map(([, n]) => n)
    if (missing.length) {
      add({
        key: `schema-product:${label}`,
        area: 'Schema',
        title: 'Richer product markup',
        evidence: `A sampled ${label} product page marks up ${missing.join(', ')}; ours does not.`,
        apply: 'Add shipping and replacement-policy markup to products now that those policies are final. Add identifiers only where you actually know them. Never invent them.',
      })
    }
    if ((op.hasAggregateRating || op.hasReview) && !sp?.hasAggregateRating) {
      add({
        key: `schema-reviews:${label}`,
        area: 'Schema',
        title: 'Product ratings in search results',
        evidence: `${label}'s sampled product page carries rating / review markup.`,
        apply: 'Only possible with genuine reviews collected on your own product pages. Your Google Business Profile reviews cannot be marked up as product reviews, and a self-awarded rating is not eligible.',
      })
    }
  }
  const theirTypes = schemaTypes(other)
  const ourTypes = self ? schemaTypes(self) : new Set<string>()
  const wanted = ['BreadcrumbList', 'ItemList', 'LocalBusiness', 'Organization', 'FAQPage', 'Article', 'BlogPosting'].filter((t) => theirTypes.has(t) && !ourTypes.has(t))
  if (wanted.length) {
    add({
      key: `schema-types:${label}`,
      area: 'Schema',
      title: 'Other markup types they use',
      evidence: `${label} uses ${wanted.join(', ')} on the pages sampled; we did not on ours.`,
      apply: 'Add the ones that match real content. Check each in the Rich Results Test. Not every type produces a visible result.',
    })
  }

  // 3. Titles
  const theirTitle = other.pages.home?.title ?? ''
  const ourTitle = self?.pages.home?.title ?? ''
  const tokens = ['india', 'warranty', 'buy', 'online', 'best'].filter((t) => theirTitle.toLowerCase().includes(t) && !ourTitle.toLowerCase().includes(t))
  if (tokens.length) {
    add({
      key: `titles:${label}`,
      area: 'Page metadata',
      title: 'What their home-page title promises',
      evidence: `${label}'s home title (“${theirTitle.slice(0, 70)}”) includes ${tokens.map((t) => `“${t}”`).join(', ')}; ours (“${ourTitle.slice(0, 70)}”) does not.`,
      apply: 'Work only terms that are true and that people search for into your own titles. The shopper-facing promise should match what you actually offer.',
      screen: 'overrides',
    })
  }

  // 4. Policy pages
  const missingPolicies = Object.keys(other.policies).filter((k) => !(self && k in self.policies))
  if (missingPolicies.length) {
    add({
      key: `policies:${label}`,
      area: 'Policies',
      title: 'Policy pages linked from their footer',
      evidence: `${label} links these policy pages that our home page does not: ${missingPolicies.join(', ')}.`,
      apply: 'Make sure each policy you really have is linked from the footer on every page.',
    })
  }

  // 5. Claims they make (the owner decides what is true for DigitalBluez)
  const ourClaimTypes = new Set((self?.claims ?? []).map((c) => c.type))
  const theirClaims = other.claims.filter((c) => !ourClaimTypes.has(c.type))
  if (theirClaims.length) {
    add({
      key: `claims:${label}`,
      area: 'Trust',
      title: 'Selling points they state on their home page',
      evidence: `${label}: ${theirClaims.map((c) => `${c.type} (“${c.text}”)`).join('; ')}.`,
      apply: 'Add one to your own pages ONLY if it is true for DigitalBluez and you can keep the promise. Never copy a number you do not match.',
    })
  }

  // 6. Content depth
  if (other.sitemap.buckets.blog >= 5 && other.sitemap.buckets.blog > (self?.sitemap.buckets.blog ?? 0) * 2) {
    add({
      key: `content-blog:${label}`,
      area: 'Content',
      title: 'Buying guides and articles',
      evidence: `${label}'s sitemap has ${other.sitemap.buckets.blog}${other.sitemap.indexed ? '+' : ''} blog / guide URLs; ours has ${self?.sitemap.buckets.blog ?? 0}.`,
      apply: 'Write guides from what you actually see in the shop (what to check on a used laptop, battery tests, which model suits whom). Each must answer a real question.',
    })
  }
  const theirColl = other.pages.collection
  const ourColl = self?.pages.collection
  if (theirColl && theirColl.wordCount >= 300 && theirColl.wordCount > (ourColl?.wordCount ?? 0) * 1.5) {
    add({
      key: `content-collection:${label}`,
      area: 'Content',
      title: 'Text on category / collection pages',
      evidence: `A sampled ${label} collection page has about ${theirColl.wordCount} words of text; ours has ${ourColl?.wordCount ?? 0}.`,
      apply: 'Give each collection a real intro (what to look for, who it suits). The gate already keeps thin collections out of search.',
      screen: 'collections',
    })
  }
  const alt = (p?: PageSignals) => (p && p.images.total ? p.images.withAlt / p.images.total : null)
  const theirAlt = alt(other.pages.home)
  const ourAlt = alt(self?.pages.home)
  if (theirAlt != null && theirAlt >= 0.9 && ourAlt != null && ourAlt < 0.7) {
    add({
      key: `images-alt:${label}`,
      area: 'Content',
      title: 'Image descriptions',
      evidence: `On the home page, ${Math.round(theirAlt * 100)}% of ${label}'s images have alt text; ours ${Math.round(ourAlt * 100)}%.`,
      apply: 'Fill missing photo descriptions in Image alt text.',
      screen: 'images',
    })
  }

  return ideas
}
