import { extractText, getDocumentProxy } from 'unpdf'

// Tier 0 of the document ingestion pipeline (see docs/decisions.md, "reconciliation
// tiered ingestion"): a free, instant, always-run probe of a PDF's embedded text
// layer. A text-layer PDF (Tally/Zoho/Busy exports, net-banking CSVs-as-PDF) parses
// deterministically and more accurately than any LLM. A scanned PDF or phone photo
// has ~no text layer -- that's the signal that Tier 2 (AI) is the only option.
//
// Threshold: real single-page invoices/statement pages we've seen run well into the
// thousands of characters; a scan-through-OCR-less PDF typically yields a few dozen
// stray characters (headers/footers the renderer picked up) or none at all. 200
// chars/page is a deliberately conservative floor -- false "needs AI" is cheap
// (Tier 2 still works, just costs tokens); false "has text" would silently feed
// near-empty text into Tier 1 template matching and produce garbage.
const MIN_CHARS_PER_PAGE = 200

export interface ProbeResult {
  pageCount: number
  textLayerChars: number
  text: string
  likelyScanned: boolean
}

export async function probeDocument(buffer: ArrayBuffer | Uint8Array): Promise<ProbeResult> {
  // unpdf's internal check rejects a Node Buffer even though `Buffer instanceof
  // Uint8Array` is true (Buffer's prototype chain isn't the plain Uint8Array
  // unpdf checks for) -- always materialize a genuinely plain Uint8Array rather
  // than trusting instanceof.
  const bytes = new Uint8Array(buffer as any)
  const pdf = await getDocumentProxy(bytes)
  const { totalPages, text } = await extractText(pdf, { mergePages: true })
  const chars = text.trim().length
  return {
    pageCount: totalPages,
    textLayerChars: chars,
    text,
    likelyScanned: chars < MIN_CHARS_PER_PAGE * Math.max(totalPages, 1),
  }
}

// ---------- Tier 1: apply a saved template's regex rules against probed text ----------

export interface TemplateFieldRule {
  // JS regex source (no delimiters). Use a single capture group unless `group` is set.
  pattern: string
  flags?: string
  group?: number
}

export interface TemplateFieldRules {
  // One rule per header field (invoice_number, invoice_date, vendor_gstin,
  // subtotal, total_gst, grand_total, ...). Bank templates instead rely primarily
  // on `lineItemPattern` since a statement's "header fields" are just the
  // account/period, extracted the same way.
  fields: Record<string, TemplateFieldRule>
  // Applied per-line (multiline mode) via named capture groups matching the target
  // schema's field names (e.g. (?<description>...) (?<qty>...) (?<rate>...) ...).
  lineItemPattern?: string
  lineItemFlags?: string
}

export interface TemplateApplyResult {
  fields: Record<string, string | null>
  lineItems: Record<string, string>[]
  unmatchedFieldCount: number
}

export function applyTemplate(text: string, rules: TemplateFieldRules): TemplateApplyResult {
  const fields: Record<string, string | null> = {}
  let unmatchedFieldCount = 0

  for (const [name, rule] of Object.entries(rules.fields)) {
    try {
      const re = new RegExp(rule.pattern, rule.flags || '')
      const match = text.match(re)
      const value = match ? (match[rule.group ?? 1] ?? match[0]) : null
      fields[name] = value ? value.trim() : null
      if (!value) unmatchedFieldCount++
    } catch {
      // A malformed saved pattern (shouldn't happen -- validated on save) fails
      // this one field rather than the whole template.
      fields[name] = null
      unmatchedFieldCount++
    }
  }

  const lineItems: Record<string, string>[] = []
  if (rules.lineItemPattern) {
    try {
      const re = new RegExp(rules.lineItemPattern, rules.lineItemFlags || 'gm')
      for (const match of text.matchAll(re)) {
        if (match.groups) lineItems.push({ ...match.groups })
      }
    } catch {
      // Malformed line pattern -- header fields above still stand on their own.
    }
  }

  return { fields, lineItems, unmatchedFieldCount }
}

// ---------- Template learning: derive a field rule from one confirmed example ----------
//
// "Save layout for this vendor" (see docs/decisions.md, "per-vendor template
// learning") deliberately costs zero extra AI calls -- it derives a regex from the
// text immediately preceding a known-correct value (an "anchor"), on the
// assumption that a vendor's invoice layout repeats the same label text
// ("Invoice No:", "GSTIN:", ...) across every invoice even though the value after
// it changes. Whitespace inside the anchor is loosened to \s+ so line-wrap/spacing
// differences between two invoices from the same vendor don't break the match.
//
// Scoped to header fields only, not line items -- deriving a reusable per-row table
// regex from a single example is a materially harder problem (column boundaries
// aren't stable the way a fixed label is) and is left as a future refinement; line
// items still go through Tier 2/manual until that's built. Header-only is still a
// real win: it's exactly what vendor reconciliation (Phase 4) needs.
const ANCHOR_LENGTH = 40

export function deriveFieldRule(text: string, value: string): TemplateFieldRule | null {
  if (!value) return null
  const idx = text.indexOf(value)
  if (idx === -1) return null

  const anchorStart = Math.max(0, idx - ANCHOR_LENGTH)
  const anchor = text.slice(anchorStart, idx)
  if (!anchor.trim()) return null // value sits at the very start of the text -- no stable label to anchor on

  const escaped = anchor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')
  return { pattern: `${escaped}([^\\n]+)`, flags: '' }
}

export function deriveFieldRules(text: string, values: Record<string, string | null | undefined>): TemplateFieldRules {
  const fields: Record<string, TemplateFieldRule> = {}
  for (const [name, value] of Object.entries(values)) {
    const rule = value ? deriveFieldRule(text, String(value)) : null
    if (rule) fields[name] = rule
  }
  return { fields }
}
