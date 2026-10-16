// Pure helpers: read a laptop's configuration out of a competitor's listing title and
// score how well it matches one of our SKUs. No network, no database.

export interface Config {
  brand: string | null
  modelTokens: string[] // alphanumeric tokens that contain a digit, e.g. ["5510"], ["t450"], ["1040","g8"]
  cpu: string | null // "i5", "i7", "ryzen5", "m1" ...
  generation: number | null
  ramGb: number | null
  ssdGb: number | null
}

const BRANDS = ['dell', 'lenovo', 'hp', 'apple', 'asus', 'acer', 'microsoft', 'msi', 'samsung', 'toshiba', 'fujitsu']

export function decodeEntities(s: string): string {
  return s
    .replace(/&#8211;|&#8212;|&ndash;|&mdash;/g, '-')
    .replace(/&#038;|&amp;/g, '&')
    .replace(/&#8217;|&#039;|&apos;/g, "'")
    .replace(/&#8243;|&quot;|&#8221;|&#8220;/g, '"')
    .replace(/&nbsp;/g, ' ')
}

const sizeToGb = (n: number, unit: string) => (/t/i.test(unit) ? n * 1024 : n)

function parseBrand(text: string): string | null {
  const t = ` ${text.toLowerCase()} `
  for (const b of BRANDS) if (new RegExp(`[^a-z]${b}[^a-z]`).test(t)) return b
  if (/thinkpad|ideapad|thinkcentre/.test(t)) return 'lenovo'
  if (/latitude|optiplex|inspiron|precision|vostro|xps/.test(t)) return 'dell'
  if (/elitebook|probook|prodesk|elitedesk|zbook/.test(t)) return 'hp'
  if (/macbook|imac/.test(t)) return 'apple'
  return null
}

export function parseCpu(text: string): string | null {
  const t = text.toLowerCase()
  let m = t.match(/\b(?:core\s*)?(i[3579])\b/)
  if (m) return m[1]
  m = t.match(/ryzen\s*([3579])/)
  if (m) return `ryzen${m[1]}`
  m = t.match(/\b(m[123])\s*(?:pro|max|ultra)?\b/)
  if (m && /apple|macbook|imac/.test(t)) return m[1]
  return null
}

export function parseGeneration(text: string): number | null {
  const m = text.toLowerCase().match(/\b(\d{1,2})\s*(?:st|nd|rd|th)?\s*[-(]?\s*gen/) || text.toLowerCase().match(/gen(?:eration)?\s*[:-]?\s*(\d{1,2})(?:st|nd|rd|th)?\b/)
  if (!m) return null
  const g = Number(m[1])
  return g >= 1 && g <= 15 ? g : null
}

export function parseRamGb(text: string): number | null {
  const m = text.match(/(\d{1,3})\s*gb\s*(?:ddr\d?\s*)?(?:ram|memory)/i) || text.match(/ram\s*[:-]?\s*(\d{1,3})\s*gb/i)
  return m ? Number(m[1]) : null
}

export function parseSsdGb(text: string): number | null {
  const m =
    text.match(/(\d{1,4})\s*(gb|tb)\s*(?:nvme\s*)?(?:ssd|m\.?2)/i) ||
    text.match(/ssd\s*[:-]?\s*(\d{1,4})\s*(gb|tb)/i)
  return m ? sizeToGb(Number(m[1]), m[2]) : null
}

export function parseWarrantyMonths(text: string): number | null {
  const y = text.match(/(\d{1,2})\s*year/i)
  const mo = text.match(/(\d{1,2})\s*month/i)
  if (mo) return Number(mo[1])
  if (y) return Number(y[1]) * 12
  return null
}

const AMBIGUOUS_NUMBERS = new Set(['128', '256', '320', '500', '512', '720', '768', '1024', '1080', '1366', '1600', '1920', '2048'])
const MODEL_STOP = new Set(['gen', 'intel', 'core', 'windows', 'win', 'hd', 'fhd', 'ssd', 'ram', 'gb', 'inch', 'inches', 'th', 'st', 'nd', 'rd', 'tb', 'ddr4', 'ddr3', 'ddr5'])

function modelTokensFrom(text: string): string[] {
  const out = new Set<string>()
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (!raw || !/\d/.test(raw)) continue
    if (/^(i[3579]|m[123])$/.test(raw)) continue // cpu names are scored separately
    if (/^\d+(gb|tb|th|st|nd|rd|hz|mm)$/.test(raw)) continue // sizes / ordinals
    if (/^\d{1,2}$/.test(raw)) continue // bare numbers are too ambiguous (screen size, gen)
    if (AMBIGUOUS_NUMBERS.has(raw)) continue // storage sizes / resolutions, not model numbers
    if (MODEL_STOP.has(raw)) continue
    out.add(raw)
  }
  return [...out]
}

export function parseTitle(title: string): Config {
  const t = decodeEntities(title)
  return {
    brand: parseBrand(t),
    modelTokens: modelTokensFrom(t),
    cpu: parseCpu(t),
    generation: parseGeneration(t),
    ramGb: parseRamGb(t),
    ssdGb: parseSsdGb(t),
  }
}

const num = (v: unknown): number | null => {
  const m = String(v ?? '').match(/\d+/)
  return m ? Number(m[0]) : null
}

/** Configuration of one of OUR sku_master rows (specifications jsonb + brand/model columns). */
export function skuConfig(sku: { brand?: string | null; model_name?: string | null; specifications?: Record<string, unknown> | null }): Config {
  const s = (sku.specifications || {}) as Record<string, unknown>
  const modelText = `${sku.model_name || s.model || ''}`
  const ssd = String(s.ssd ?? '')
  return {
    brand: sku.brand ? sku.brand.toLowerCase() : parseBrand(`${s.brand ?? ''}`),
    modelTokens: modelTokensFrom(modelText),
    cpu: s.cpu ? String(s.cpu).toLowerCase().replace(/\s+/g, '') : null,
    generation: num(s.generation),
    ramGb: num(s.ram),
    ssdGb: /tb/i.test(ssd) ? (num(ssd) ?? 0) * 1024 || null : num(ssd),
  }
}

export interface MatchResult {
  score: number
  /** true only when model, CPU, generation, RAM and SSD all agree: safe to compare prices directly */
  exact: boolean
  reasons: string[]
}

const NO_MATCH = (why: string): MatchResult => ({ score: 0, exact: false, reasons: [why] })

/**
 * 0..1 score for "is this competitor listing the same machine as our SKU?".
 * Different brand, model number, CPU or generation is a hard no. A different RAM or SSD
 * size keeps the model match but is marked not-exact, so the board can offer it as a
 * "similar" machine for the owner to judge instead of silently comparing unlike prices.
 */
export function matchScore(ours: Config, theirs: Config): MatchResult {
  const reasons: string[] = []
  if (ours.brand && theirs.brand && ours.brand !== theirs.brand) return NO_MATCH('different brand')
  if (!ours.modelTokens.length) return NO_MATCH('our model has no model number')
  const same = (a: string, b: string) => a === b || a === 'x' + b || b === 'x' + a // "360" vs "x360"
  const missing = ours.modelTokens.filter((tok) => !theirs.modelTokens.some((t) => same(tok, t)))
  if (missing.length) return NO_MATCH(`model differs (${missing.join(', ')})`)

  let score = 0.5
  reasons.push('same model')
  if (ours.cpu && theirs.cpu) {
    if (ours.cpu === theirs.cpu) { score += 0.15; reasons.push('same CPU') } else return NO_MATCH('different CPU')
  }
  if (ours.generation && theirs.generation) {
    if (ours.generation === theirs.generation) { score += 0.1; reasons.push('same generation') } else return NO_MATCH('different generation')
  }
  let exact = true
  if (ours.ramGb != null && theirs.ramGb != null) {
    if (ours.ramGb === theirs.ramGb) { score += 0.125; reasons.push('same RAM') } else { exact = false; reasons.push(`RAM ${theirs.ramGb} GB vs your ${ours.ramGb} GB`) }
  }
  if (ours.ssdGb != null && theirs.ssdGb != null) {
    if (ours.ssdGb === theirs.ssdGb) { score += 0.125; reasons.push('same SSD') } else { exact = false; reasons.push(`SSD ${theirs.ssdGb} GB vs your ${ours.ssdGb} GB`) }
  }
  return { score: Math.min(1, Math.round(score * 100) / 100), exact, reasons }
}

/** Exact matches at or above this are offered as the suggested comparison. */
export const SUGGEST_THRESHOLD = 0.75
/** Same model but a different RAM/SSD size: offered as "similar", owner decides. */
export const SIMILAR_THRESHOLD = 0.6
