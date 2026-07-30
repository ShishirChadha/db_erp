// Case/whitespace/punctuation-insensitive comparison for free-text catalog values
// (custom_options.value, sku_master.brand/model_name). Deliberately conservative --
// exact-normalized-equality plus a word-boundary-safe containment check -- not real
// fuzzy matching (typos, transposed words). Containment is what catches the reported
// bug pattern: "T450" vs "ThinkPad T450" are not equal under any amount of
// case/whitespace normalization, but one is contained in the other.
export function normalizeForComparison(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
}

export function isLikelyDuplicateText(a: string, b: string): boolean {
  const na = normalizeForComparison(a)
  const nb = normalizeForComparison(b)
  if (!na || !nb) return false
  if (na === nb) return true
  const [shorter, longer] = na.length <= nb.length ? [na, nb] : [nb, na]
  const escaped = shorter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|\\s)${escaped}(\\s|$)`).test(longer)
}
