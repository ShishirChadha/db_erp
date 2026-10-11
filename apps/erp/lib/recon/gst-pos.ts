import { STATE_CODE_TO_NAME } from '@db/shared'

// Zoho Books exports Place of Supply as an abbreviation ("UP", "MH"), a name, or
// "Name (code)" depending on version/report. Normalising to the 2-digit GST state
// code is what makes it comparable to invoices.place_of_supply. Anything
// unrecognised returns null, so an unfamiliar format is skipped rather than
// reported as a false mismatch.
const ABBREVIATIONS: Record<string, string> = {
  JK: '01', HP: '02', PB: '03', CH: '04', UK: '05', UT: '05', UA: '05', HR: '06', DL: '07', RJ: '08', UP: '09',
  BR: '10', SK: '11', AR: '12', NL: '13', MN: '14', MZ: '15', TR: '16', ML: '17', AS: '18', WB: '19', JH: '20',
  OD: '21', OR: '21', CG: '22', CT: '22', MP: '23', GJ: '24', DD: '25', DN: '26', MH: '27', AP: '37', KA: '29',
  GA: '30', LD: '31', KL: '32', TN: '33', PY: '34', AN: '35', TS: '36', TG: '36', LA: '38',
}

const BY_NAME: Record<string, string> = Object.fromEntries(
  Object.entries(STATE_CODE_TO_NAME)
    // 28 is the retired pre-bifurcation Andhra Pradesh; a current invoice is 37.
    .filter(([code]) => code !== '28')
    .map(([code, name]) => [name.toLowerCase().replace(/\s*\(old\)$/, ''), code])
)

export function normalizePlaceOfSupply(raw: unknown): string | null {
  const s = String(raw ?? '').trim()
  if (!s) return null

  const bare = s.match(/^(\d{2})(?:\D|$)/)
  if (bare && STATE_CODE_TO_NAME[bare[1]]) return bare[1]

  const bracketed = s.match(/\((\d{2})\)/) ?? s.match(/[-–]\s*(\d{2})\b/)
  if (bracketed && STATE_CODE_TO_NAME[bracketed[1]]) return bracketed[1]

  const upper = s.toUpperCase().replace(/[^A-Z]/g, '')
  if (upper.length === 2 && ABBREVIATIONS[upper]) return ABBREVIATIONS[upper]

  const lower = s.toLowerCase()
  // Longest name first, so "Dadra and Nagar Haveli..." isn't shadowed by a shorter match.
  const names = Object.keys(BY_NAME).sort((a, b) => b.length - a.length)
  const hit = names.find((n) => lower.includes(n))
  return hit ? BY_NAME[hit] : null
}
