// Shared CPU-tier + generation ranking -- i3 (lowest generation first), then i5, then
// i7, then i9, everything else last. Used both by findInStockProducts (product-data.ts,
// so Today's Picks' browse grid is already in this order) and by
// buildProductListWhatsAppMessage (whatsapp-template.ts, for the generated message's
// own header/variant order) -- one definition so the grid you pick from and the
// broadcast it produces always agree on ordering.

// Real spec data has several ways of saying "not set": missing key, null, empty string,
// and -- specifically for ram/ssd/generation -- the literal string "No" (a legacy data-
// entry convention, not a real value).
export function isMissingSpecValue(v: unknown): boolean {
  if (v === null || v === undefined) return true
  const s = String(v).trim()
  return s === '' || /^no$/i.test(s)
}

// CPU tier order: i3, then i5, then i7, then i9 -- everything else (AMD Ryzen, Apple
// Silicon, unrecognized/"Mix" values) sorts after all four Intel Core tiers.
export function cpuTierRank(cpu: unknown): number {
  const c = String(cpu ?? '').trim().toLowerCase()
  if (c.startsWith('i3')) return 0
  if (c.startsWith('i5')) return 1
  if (c.startsWith('i7')) return 2
  if (c.startsWith('i9')) return 3
  return 4
}

// Generation, ascending, within a CPU tier -- "i3 1st gen, 2nd gen, 3rd... then i5" per
// the owner's own framing. parseInt naturally strips an ordinal suffix ("10th" -> 10,
// "3rd" -> 3). A missing/"No" generation sorts last within its tier; a genuinely
// unparseable value (stray data like a raw chip model number) sorts just before that.
export function generationRank(generation: unknown): number {
  if (isMissingSpecValue(generation)) return Number.MAX_SAFE_INTEGER
  const n = parseInt(String(generation).trim(), 10)
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER - 1
}

export function cpuSortKey(specs: Record<string, any> | null | undefined): [number, number] {
  const s = specs || {}
  return [cpuTierRank(s.cpu), generationRank(s.generation)]
}

export function compareCpuSortKey(a: [number, number], b: [number, number]): number {
  return a[0] - b[0] || a[1] - b[1]
}
