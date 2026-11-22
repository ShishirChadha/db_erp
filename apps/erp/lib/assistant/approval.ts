// Whether the owner's latest message approves the pending card -- decided here
// in code, not by the model (2026-11-22 security review). Before this, saving
// relied on the model judging "he said yes", so a misheard word, someone else's
// "haan" or instructions planted in ERP text could get a card saved.
//
// Approval = the owner tapped Confirm on that card (the panel sends its id), or
// the whole message is a plain yes: every word from the list below, at least one
// real yes-word, no number, no "nahi"/"but". "Haan, lekin GST ke saath" is not a
// yes -- it is a change, which needs a new proposal anyway.
import { NAME_VARIANTS } from '@/components/assistant/names'

const norm = (s: string) => s.toLowerCase().replace(/'/g, '').replace(/[^\p{L}\p{M}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim()
const set = (s: string) => new Set(s.split(' '))

const YES_KEYS = set('haan han haa ha haanji hanji yes yeah yep yup ok okay okk theek thik confirm confirmed save bilkul sure chalega done kar karo kardo karde kariye kijiye perfect correct sahi ahead proceed हाँ हां हा ठीक कन्फर्म बिल्कुल चलेगा करो')
const YES_WORDS = new Set([...YES_KEYS, ...set('ji hai h do de dena dedo dijiye please pls plz go right absolutely chalo bhai yaar baby jaanu janu jaan boss abhi jaldi it its fine na हाँजी जी है दो दीजिए कर')])
// ("na" is not here: "kar do na" means please do it.)
const NEGATION = /(^| )(nahi|nahin|nhi|no|not|mat|ruko|ruk|cancel|wait|but|lekin|magar)( |$)|नहीं|नही|मत|रुको|लेकिन/
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const NAMES = NAME_VARIANTS.map(norm).sort((a, b) => b.length - a.length)

export function isPlainYes(text: string, callMe = ''): boolean {
  let t = ` ${norm(text)} `
  if (!t.trim() || t.length > 70 || /\p{N}/u.test(t) || NEGATION.test(t.trim())) return false
  for (const n of [...NAMES, ...norm(callMe).split(' ').filter(Boolean)]) t = t.replace(new RegExp(`(?<= )${escapeRe(n)}(?= )`, 'g'), '')
  const words = t.trim().split(' ').filter(Boolean)
  return words.length > 0 && words.every((w) => YES_WORDS.has(w)) && words.some((w) => YES_KEYS.has(w))
}

// Kinds that, with "tap to confirm sales and expenses" on, need the Confirm tap.
export const TAP_ONLY_KINDS = new Set(['sale', 'expense'])
