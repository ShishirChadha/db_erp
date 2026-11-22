// Free, instant replies to messages that need no thinking: "Hi DB", "sun rahi
// ho?", "thank you", "bye". Answered here in the browser with a fixed line --
// no AI call (each one would cost ~₹0.2 on Sonnet), no server round trip.
//
// Deliberately narrow: EVERY word of the message must belong to one small
// vocabulary, so anything with real content ("Hi DB, PI bana do", "sun rahi
// ho, 4000 ka petrol") still goes to her. Words that can be an answer to her
// question -- "haan", "ji", "ok", "theek hai", "bas" -- never make an instant
// reply on their own, so "Kar doon?" -> "haan" always reaches her. Negations
// ("nahi sun pa rahi") and anything with a number go to her too.
import { NAME_VARIANTS } from './names'

export type InstantKind = 'greet' | 'hearing' | 'thanks' | 'bye'

const norm = (s: string) => s.toLowerCase().replace(/'/g, '').replace(/[^\p{L}\p{M}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim()
const set = (s: string) => new Set(s.split(' '))

const GREET = set('hi hii hiii hey hay hei hello helo hallo hullo namaste namaskar suno sunao oye arre are good morning evening afternoon हाय हे हेलो हैलो नमस्ते सुनो अरे')
// Pet names he calls her (or echoes back): fine next to other words, never a message on their own.
const ADDRESS = set('baby babu jaan jaanu janu dear yaar ji madam mam didi बेबी जान जानू यार जी')
const HEARING = set('kya tum tumhe tumhein tumhen tumko aap aapko mujhe meri mera baat ye yeh yah ise isko awaaz aawaz awaz aawaaz sun sunn suna sunai sunayi sunaai de pa paa rahi raha rahe ho hai hain se acche achhe achche achchhe theek sahi saaf ab abhi can could you hear me do are there listening still now properly clearly क्या तुम तुम्हें तुमको आप आपको मुझे मेरी बात ये यह आवाज़ आवाज सुन सुनाई दे पा रही रहा हो है हैं')
const HEARING_KEY = /^(sun|sunn|suna|sunai|sunayi|sunaai|hear|listening|there|सुन|सुनाई)$/
const THANKS = set('thank thanks thankyou thanku you so very much shukriya dhanyavaad dhanyawad dhanyavad dhanyawaad bahut ok okay achha theek hai धन्यवाद शुक्रिया थैंक यू बहुत')
const THANKS_KEY = /^(thank|thanks|thankyou|thanku|shukriya|dhanya\S*|धन्यवाद|शुक्रिया|थैंक)$/
const BYE = set('bye byee bbye byebye goodbye good night tata chalo ok okay see you later phir milte hain theek hai achha बाय गुड नाइट चलो टाटा')
const BYE_KEY = /^(bye|byee|bbye|byebye|goodbye|night|tata|milte|बाय|नाइट|टाटा)$/
const NEGATION = /(^| )(nahi|nahin|nhi|not|cant|cannot|dont|no)( |$)|नहीं|नही/

const NAME = '#db#' // placeholder for DB's name, its mishearings and taught wake phrases
const NAMES = NAME_VARIANTS.map(norm).sort((a, b) => b.length - a.length)

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
function tokens(text: string, wakePhrases: string[]) {
  let t = ` ${norm(text)} `
  const phrases = wakePhrases.map(norm).filter(Boolean).sort((a, b) => b.length - a.length)
  for (const p of [...phrases, ...NAMES]) t = t.replace(new RegExp(`(?<= )${escapeRe(p)}(?= )`, 'g'), NAME)
  return t.trim().split(' ').filter(Boolean)
}

export function instantKind(text: string, wakePhrases: string[] = []): InstantKind | null {
  const raw = norm(text)
  if (!raw || raw.length > 60 || /\p{N}/u.test(raw) || NEGATION.test(raw)) return null
  const all = tokens(text, wakePhrases)
  const named = all.includes(NAME)
  const rest = all.filter((w) => w !== NAME && !ADDRESS.has(w))
  // Only her name or a greeting: "DB", "Hi DB", "hello baby", "suno".
  if (rest.every((w) => GREET.has(w)) && (named || rest.length > 0)) return 'greet'
  const within = (s: Set<string>) => rest.every((w) => s.has(w) || GREET.has(w))
  if (within(HEARING) && rest.some((w) => HEARING_KEY.test(w))) return 'hearing'
  if (within(THANKS) && rest.some((w) => THANKS_KEY.test(w))) return 'thanks'
  if (within(BYE) && rest.some((w) => BYE_KEY.test(w))) return 'bye'
  return null
}

// English in, English out; otherwise Hinglish in the owner's chosen script.
const HINDI_WORD = /(^| )(kya|tum|tumhe|tumko|aap|mujhe|sun|suno|sunai|rahi|raha|ho|hai|shukriya|dhanya\S*|chalo|tata|milte|achha|theek|bahut|namaste|arre)( |$)/
function looksEnglish(text: string) {
  const t = norm(text)
  return /^[a-z ]+$/.test(t) && !HINDI_WORD.test(t)
}

export function instantReply(kind: InstantKind, text: string, o: { callMe: string; wakeReply: string; script: 'devanagari' | 'roman' }) {
  const a = o.callMe.trim() || 'Boss'
  const en = looksEnglish(text)
  const hi = o.script === 'devanagari'
  switch (kind) {
    case 'greet': return o.wakeReply.trim() || (hi ? `हाँ ${a}, बोलिए?` : `Haan ${a}, boliye?`)
    case 'hearing': return en ? `Yes ${a}, I can hear you. Go ahead.` : hi ? `हाँ ${a}, सुन रही हूँ। बोलिए?` : `Haan ${a}, sun rahi hoon. Boliye?`
    case 'thanks': return en ? `Anytime, ${a}!` : hi ? `अरे कोई बात नहीं ${a}!` : `Arre koi baat nahi ${a}!`
    case 'bye':
      if (/night|नाइट/i.test(text)) return `Good night ${a}!`
      return en ? `Bye ${a}!` : hi ? `ठीक है ${a}, bye!` : `Theek hai ${a}, bye!`
  }
}
