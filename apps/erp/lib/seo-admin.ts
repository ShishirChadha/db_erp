import { supabaseAdmin } from '@/lib/supabase/service'

// Shared validation + history helpers for the owner-only Website SEO routes
// (app/api/website-seo/**). The storefront reads these tables through the
// public_seo_* / public_redirects views (migration 20261015).

export const OVERRIDE_TYPES = ['product', 'category', 'static', 'blog'] as const
export type OverrideType = (typeof OVERRIDE_TYPES)[number]

// "/privacy/" , " privacy " , "/privacy?x=1" -> "/privacy". The home page stays "/".
export function normalizePath(input: string): string {
  let p = String(input ?? '').trim()
  if (/^https?:\/\//i.test(p)) return p
  p = p.split('#')[0].split('?')[0]
  if (!p.startsWith('/')) p = `/${p}`
  p = p.replace(/\/{2,}/g, '/')
  if (p.length > 1) p = p.replace(/\/+$/, '')
  return p
}

export interface OverrideInput {
  entity_type?: unknown
  entity_key?: unknown
  meta_title?: unknown
  meta_description?: unknown
  og_image_path?: unknown
  robots_index?: unknown
  canonical_override?: unknown
  status?: unknown
}

const optText = (v: unknown): string | null => {
  if (v === undefined || v === null) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

// Hard errors block the save; warnings are returned to the UI so the owner can
// still publish a title that is a little long (Google truncates, it does not reject).
export function validateOverride(b: OverrideInput):
  | { ok: true; row: Record<string, unknown>; warnings: string[] }
  | { ok: false; error: string } {
  const type = String(b.entity_type ?? '')
  if (!(OVERRIDE_TYPES as readonly string[]).includes(type)) return { ok: false, error: 'Invalid entity_type' }
  let key = String(b.entity_key ?? '').trim()
  if (!key) return { ok: false, error: 'entity_key is required' }
  if (type === 'static') key = normalizePath(key)
  if (type === 'category') key = key.toUpperCase()

  const title = optText(b.meta_title)
  const description = optText(b.meta_description)
  const canonical = optText(b.canonical_override)
  const ogImage = optText(b.og_image_path)
  const status = b.status === 'published' ? 'published' : 'draft'

  if (title && title.length > 70) return { ok: false, error: 'Title is over 70 characters; search results will cut it off' }
  if (description && description.length > 200) return { ok: false, error: 'Description is over 200 characters' }
  if (canonical && !/^\/|^https:\/\//.test(canonical)) {
    return { ok: false, error: 'Canonical must start with / or https://' }
  }
  if (b.robots_index !== undefined && b.robots_index !== null && typeof b.robots_index !== 'boolean') {
    return { ok: false, error: 'robots_index must be true, false or empty' }
  }

  const warnings: string[] = []
  if (title && title.length > 60) warnings.push('Title is over 60 characters and may be truncated')
  if (description && description.length < 70) warnings.push('Description is under 70 characters')
  if (description && description.length > 160) warnings.push('Description is over 160 characters and may be truncated')
  if (status === 'published' && !title && !description && b.robots_index == null && !canonical && !ogImage) {
    warnings.push('Nothing is overridden; this published row has no effect')
  }

  return {
    ok: true,
    warnings,
    row: {
      entity_type: type,
      entity_key: key,
      meta_title: title,
      meta_description: description,
      og_image_path: ogImage,
      robots_index: typeof b.robots_index === 'boolean' ? b.robots_index : null,
      canonical_override: canonical,
      status,
    },
  }
}

export async function recordRevision(
  entityType: 'settings' | 'override' | 'redirect' | 'collection',
  entityKey: string,
  action: 'upsert' | 'delete',
  snapshot: Record<string, unknown>,
  userId: string | null
) {
  // History is best-effort, same posture as logAuditEvent: never block the change.
  try {
    await supabaseAdmin.from('seo_revisions').insert({
      entity_type: entityType,
      entity_key: entityKey,
      action,
      snapshot,
      created_by: userId,
    })
  } catch {
    /* ignore */
  }
}

// Creates (or repoints) a permanent redirect while keeping the table free of
// loops and multi-hop chains, so the storefront only ever needs a single lookup.
export async function addRedirect(opts: {
  from: string
  to: string
  source: 'manual' | 'auto'
  note?: string | null
  userId: string | null
  // true when `to` is a page that now exists (a renamed product's new URL):
  // any redirect that used to move that URL elsewhere is dropped.
  targetIsLive?: boolean
}): Promise<{ ok: true; row: Record<string, any> } | { ok: false; error: string }> {
  const from = normalizePath(opts.from)
  let to = normalizePath(opts.to)
  if (!from.startsWith('/')) return { ok: false, error: 'From must be a path on this site, e.g. /old-page' }
  if (from === '/') return { ok: false, error: 'The home page cannot be redirected' }
  if (from === to) return { ok: false, error: 'From and To are the same' }

  if (opts.targetIsLive && to.startsWith('/')) {
    await supabaseAdmin.from('seo_redirects').delete().eq('from_path', to)
  }

  // Follow existing redirects from the target so we store the final destination.
  const seen = new Set<string>([from])
  for (let i = 0; i < 10 && to.startsWith('/'); i++) {
    if (seen.has(to)) return { ok: false, error: 'This would create a redirect loop' }
    seen.add(to)
    const { data: next } = await supabaseAdmin.from('seo_redirects').select('to_path').eq('from_path', to).maybeSingle()
    if (!next) break
    to = next.to_path
  }
  if (to === from) return { ok: false, error: 'This would create a redirect loop' }

  const { data, error } = await supabaseAdmin
    .from('seo_redirects')
    .upsert(
      { from_path: from, to_path: to, source: opts.source, note: opts.note ?? null, created_by: opts.userId },
      { onConflict: 'from_path' }
    )
    .select()
    .single()
  if (error || !data) return { ok: false, error: error?.message ?? 'Failed to save redirect' }

  // Anything that pointed at `from` now skips straight to the final target.
  await supabaseAdmin.from('seo_redirects').update({ to_path: to }).eq('to_path', from).neq('from_path', to)
  return { ok: true, row: data }
}

// ---------------------------------------------------------------- collections

const FILTER_LIST_KEYS = ['brand', 'cpu', 'ram', 'ssd', 'gpuType', 'os', 'warranty'] as const
const COLLECTION_KINDS = ['brand', 'budget', 'spec', 'use_case']

export function wordCount(text: string | null | undefined): number {
  return (text ?? '').trim().split(/\s+/).filter(Boolean).length
}

// Order/case-insensitive form of a filter, used to refuse two collections that
// would show the same products under different URLs.
export function canonicalFilter(filter: Record<string, any>): string {
  const norm: Record<string, unknown> = {}
  for (const k of FILTER_LIST_KEYS) {
    const v = filter[k]
    if (Array.isArray(v) && v.length) norm[k] = v.map((x: string) => x.toLowerCase().replace(/\s+/g, '')).sort()
  }
  if (typeof filter.minPrice === 'number') norm.minPrice = filter.minPrice
  if (typeof filter.maxPrice === 'number') norm.maxPrice = filter.maxPrice
  return JSON.stringify(norm)
}

export function validateCollection(b: Record<string, any>):
  | { ok: true; row: Record<string, any>; warnings: string[] }
  | { ok: false; error: string } {
  const category = String(b.category ?? '').toUpperCase()
  if (!['LAP', 'DES'].includes(category)) return { ok: false, error: 'Collections are available for laptops (LAP) and desktops (DES)' }
  const slug = String(b.slug ?? '').trim().toLowerCase()
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length > 60) {
    return { ok: false, error: 'Slug may only use lowercase letters, numbers and single hyphens (max 60), e.g. dell or under-20000' }
  }
  const kind = String(b.kind ?? '')
  if (!COLLECTION_KINDS.includes(kind)) return { ok: false, error: 'Invalid collection type' }
  const name = optText(b.name)
  if (!name || name.length > 80) return { ok: false, error: 'Name is required (max 80 characters)' }
  const h1 = optText(b.h1)
  const title = optText(b.meta_title)
  const description = optText(b.meta_description)
  const intro = optText(b.intro_md)
  if (h1 && h1.length > 100) return { ok: false, error: 'Heading is over 100 characters' }
  if (title && title.length > 70) return { ok: false, error: 'Title is over 70 characters; search results will cut it off' }
  if (description && description.length > 200) return { ok: false, error: 'Description is over 200 characters' }
  if (intro && intro.length > 8000) return { ok: false, error: 'Intro is over 8000 characters' }

  // filter
  const rawFilter = (b.filter && typeof b.filter === 'object' ? b.filter : {}) as Record<string, any>
  const filter: Record<string, unknown> = {}
  for (const k of FILTER_LIST_KEYS) {
    const v = rawFilter[k]
    if (v === undefined || v === null || (Array.isArray(v) && v.length === 0)) continue
    if (!Array.isArray(v) || v.length > 10 || v.some((x) => typeof x !== 'string' || !x.trim() || x.length > 60)) {
      return { ok: false, error: `Filter "${k}" must be a short list of values` }
    }
    const list = v.map((x: string) => x.trim())
    if (k === 'gpuType' && list.some((x) => !['Integrated', 'Dedicated'].includes(x))) {
      return { ok: false, error: 'Graphics must be Integrated or Dedicated' }
    }
    filter[k] = list
  }
  for (const k of ['minPrice', 'maxPrice'] as const) {
    const v = rawFilter[k]
    if (v === undefined || v === null || v === '') continue
    const n = Number(v)
    if (!Number.isFinite(n) || n < 0) return { ok: false, error: `${k} must be a non-negative number` }
    filter[k] = n
  }
  if (typeof filter.minPrice === 'number' && typeof filter.maxPrice === 'number' && filter.minPrice > filter.maxPrice) {
    return { ok: false, error: 'Minimum price is above the maximum price' }
  }
  if (Object.keys(filter).length === 0) return { ok: false, error: 'Choose at least one filter (brand, price, RAM…) or this page would list everything' }

  // faq
  const faqIn = Array.isArray(b.faq) ? b.faq : []
  if (faqIn.length > 10) return { ok: false, error: 'At most 10 FAQ entries' }
  const faq: { q: string; a: string }[] = []
  for (const f of faqIn) {
    const q = optText(f?.q)
    const a = optText(f?.a)
    if (!q && !a) continue
    if (!q || !a || q.length > 200 || a.length > 1000) return { ok: false, error: 'Each FAQ needs a question (max 200) and an answer (max 1000)' }
    faq.push({ q, a })
  }

  const minProducts = Number(b.min_products ?? 3)
  const minWords = Number(b.min_intro_words ?? 120)
  if (!Number.isInteger(minProducts) || minProducts < 1 || minProducts > 50) return { ok: false, error: 'Minimum products must be a whole number from 1 to 50' }
  if (!Number.isInteger(minWords) || minWords < 0 || minWords > 1000) return { ok: false, error: 'Minimum intro words must be a whole number from 0 to 1000' }
  const status = b.status === 'published' ? 'published' : 'draft'

  const warnings: string[] = []
  if (title && title.length > 60) warnings.push('Title is over 60 characters and may be truncated')
  if (description && description.length > 160) warnings.push('Description is over 160 characters and may be truncated')
  const words = wordCount(intro)
  if (status === 'published' && words < minWords) {
    warnings.push(`Intro has ${words} words; the page stays hidden from search until it has ${minWords}`)
  }

  return {
    ok: true,
    warnings,
    row: { category, slug, kind, name, h1, meta_title: title, meta_description: description, intro_md: intro, faq, filter, min_products: minProducts, min_intro_words: minWords, status },
  }
}
