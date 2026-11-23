import { supabaseAdmin } from '@/lib/supabase/service'
import { encryptPassword, decryptPassword } from '@/lib/auth/password-vault'
import type { SessionUser } from '@/lib/auth/session'
import { ALL_READ_MODULES, type ReadModule } from './reports'
import { DEFAULT_APPEARANCE, cleanAppearance, type Appearance } from '@/components/assistant/appearance'

// Everything the owner can change about DB, in one app_settings row
// (assistant_settings, JSON). app_settings has RLS on with no policies, so only
// the service role reads it; the Sarvam key is additionally encrypted with the
// same vault that keeps staff passwords.
export const ASSISTANT_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'] as const
export type AssistantModel = typeof ASSISTANT_MODELS[number]

// Female Bulbul v4-flash voices from Sarvam's own recommendations (best-practices
// page, "Female" column), plus the two personas Sarvam names for mixed
// English/Hindi copy. Owner auditions them with Preview in Settings.
export const SARVAM_VOICES = [
  { id: 'simran_enhi_customer', label: 'Simran — Hinglish, friendly' },
  { id: 'ishita_enhi_customer', label: 'Ishita — Hinglish, friendly' },
  { id: 'aparna_hi_customer', label: 'Aparna — Hindi, warm' },
  { id: 'aparna_en_companion', label: 'Aparna — English, caring' },
  { id: 'simran_en_sales', label: 'Simran — English, lively' },
  { id: 'zarina_en_conversation', label: 'Zarina — English, conversational' },
] as const

export const VOICE_PROVIDERS = ['sarvam', 'azure', 'google', 'browser'] as const
export const TONES = ['professional', 'friendly', 'casual'] as const
export const REPLY_LENGTHS = ['short', 'normal'] as const
export type ReplyLength = typeof REPLY_LENGTHS[number]

// What DB may DO (her write skills), each switchable in Settings. Lookups that
// a skill needs stay available regardless.
export const WRITE_SKILLS = [
  { key: 'pi', label: 'PIs & quotations', hint: 'Prepare proforma invoices and quotations, and the WhatsApp link to send them.' },
  { key: 'expense', label: 'Expenses', hint: 'Record expenses.' },
  { key: 'sale', label: 'Sales', hint: 'Enter sales (moves stock).' },
  { key: 'repair', label: 'Repair jobs', hint: 'Open repair jobs.' },
  { key: 'replacement', label: 'Replacement jobs', hint: 'Open replacement jobs (a unit goes out).' },
  { key: 'customer', label: 'New customers', hint: 'Create a customer when one doesn’t exist yet.' },
  { key: 'learn', label: 'Learn by herself', hint: 'Offer to remember your preferences from conversations (always asks first).' },
  { key: 'stock_in', label: 'Stock in', hint: 'Enter laptops/desktops you received (by serial number, read back to you) and accessories received (by quantity, with vendor and price).' },
  { key: 'trade_in', label: 'Trade-ins (upgrades)', hint: 'When a customer gives an old laptop towards a new one: buy it back at your price and record it on the sale.' },
] as const
// The skills that existed before "new skills start on" (2026-11-23). A skill
// added later is on for the owner until he saves "What DB can do" with it off
// (skills_offered records what he has seen there).
const SKILLS_BEFORE_2026_11_23 = ['pi', 'expense', 'sale', 'repair', 'replacement', 'customer', 'learn']
export type WriteSkill = typeof WRITE_SKILLS[number]['key']
export const ALL_WRITE_SKILLS = WRITE_SKILLS.map((s) => s.key) as WriteSkill[]
export type Tone = typeof TONES[number]
// How hard DB ignores quiet / far-away speech (other people in the room, TV).
export const VOICE_GATES = ['off', 'low', 'medium', 'high'] as const
export type VoiceGate = typeof VOICE_GATES[number]
export type VoiceProvider = typeof VOICE_PROVIDERS[number]

export interface AssistantSettings {
  master_profile_ids: string[]
  model: AssistantModel
  // Who speaks her replies, and who listens to Shishir -- chosen separately so
  // a voice can be trialled without changing how she hears.
  voice_provider: VoiceProvider
  listen_provider: 'sarvam' | 'azure' | 'browser'
  azure_stt_language: 'en-IN' | 'hi-IN' // what Azure listens for (en-IN suits Hinglish spoken mostly in English)
  // Pause DB on every device (wake word and listening off) until this time;
  // '9999-12-31T00:00:00Z' = until turned back on. null = not paused.
  paused_until: string | null
  tts_speaker: string // Sarvam voice
  azure_region: string
  azure_voice: string // persona, e.g. 'Aarti' -> hi-IN-AartiNeural / en-IN-AartiNeural
  google_voice: string // Chirp 3 HD name, e.g. 'Aoede' -> hi-IN-Chirp3-HD-Aoede
  tts_pace: number
  speak_replies: boolean
  wake_word: boolean
  wake_phrases: string[]
  hinglish_script: 'devanagari' | 'roman'
  tone: Tone
  call_me: string // how she addresses him ("Boss")
  wake_reply: string // what she says when woken by the wake word
  reply_length: ReplyLength
  write_skills: WriteSkill[]
  // Write skills that existed when the owner last saved "What DB can do".
  skills_offered?: string[]
  // Blanket expense access: DB may record your owner-only (private) expense
  // types and create / merge expense categories -- always via her confirm card.
  expense_full_access: boolean
  // Greetings, "sun rahi ho?", thanks and bye get a fixed reply in the
  // browser with no AI call (components/assistant/instant-replies.ts).
  instant_replies: boolean
  // After an hour with no message (her instruction cache has expired too),
  // the next message starts a new conversation, so she doesn't re-read and
  // re-cache the whole old chat on every reply. A pending card keeps it open.
  fresh_after_break: boolean
  // Sales and expenses save only on a tap on Confirm (a spoken "haan" isn't
  // enough) -- for when other people are around her devices.
  tap_to_confirm_money: boolean
  // Her own picture (avatar style 'photo'): version of the private file at
  // documents/assistant/avatar/<version>; '' = none. Set only by
  // /api/assistant/avatar, never by the Settings form.
  avatar_photo_version: string
  // Conversation mode: after she answers, she listens again by herself until
  // you go quiet for conversation_idle_seconds.
  continuous_conversation: boolean
  conversation_idle_seconds: number
  voice_gate: VoiceGate
  read_modules: ReadModule[]
  appearance: Appearance // look and feel (components/assistant/appearance.ts)
  anthropic_credit_usd: number | null
  sarvam_credit_inr: number | null
  credit_since: string | null // spend is counted from this date
}

export const DEFAULT_SETTINGS: AssistantSettings = {
  master_profile_ids: [],
  model: 'claude-opus-5-5',
  voice_provider: 'sarvam',
  listen_provider: 'sarvam',
  azure_stt_language: 'en-IN',
  paused_until: null,
  tts_speaker: 'simran_enhi_customer',
  azure_region: 'centralindia',
  azure_voice: 'Aarti',
  google_voice: 'Aoede',
  tts_pace: 1.05,
  speak_replies: true,
  wake_word: false,
  wake_phrases: ['hey db', 'hi db', 'db suno', 'suno db', 'hello db', 'hi tp', 'hey tp', 'hi idbi'],
  hinglish_script: 'devanagari',
  tone: 'casual',
  call_me: 'Boss',
  wake_reply: 'Yes Boss?',
  reply_length: 'short',
  write_skills: [...ALL_WRITE_SKILLS],
  expense_full_access: true,
  instant_replies: true,
  fresh_after_break: true,
  tap_to_confirm_money: false,
  avatar_photo_version: '',
  continuous_conversation: true,
  conversation_idle_seconds: 15,
  voice_gate: 'medium',
  read_modules: [...ALL_READ_MODULES],
  appearance: DEFAULT_APPEARANCE,
  anthropic_credit_usd: null,
  sarvam_credit_inr: null,
  credit_since: null,
}

const KEY = 'assistant_settings'
const SARVAM_KEY = 'assistant_sarvam_key'

export async function getAssistantSettings(): Promise<AssistantSettings> {
  const { data } = await supabaseAdmin.from('app_settings').select('value').eq('key', KEY).maybeSingle()
  let stored: Partial<AssistantSettings> = {}
  try { stored = data?.value ? JSON.parse(data.value) : {} } catch { stored = {} }
  const merged: AssistantSettings = { ...DEFAULT_SETTINGS, ...stored, appearance: cleanAppearance(stored.appearance) }
  const offered = stored.skills_offered ?? SKILLS_BEFORE_2026_11_23
  const fresh = ALL_WRITE_SKILLS.filter((k) => !offered.includes(k) && !merged.write_skills.includes(k))
  if (fresh.length) merged.write_skills = [...merged.write_skills, ...fresh]
  return merged
}

export async function saveAssistantSettings(patch: Partial<AssistantSettings>, by: string): Promise<AssistantSettings> {
  const next = { ...(await getAssistantSettings()), ...patch }
  await supabaseAdmin.from('app_settings')
    .upsert({ key: KEY, value: JSON.stringify(next), updated_at: new Date().toISOString(), updated_by: by }, { onConflict: 'key' })
  return next
}

// DB answers to one person (or a short list of that person's own logins) -- not
// to every owner. Enforced on every /api/assistant/* route.
export async function isDbMaster(user: SessionUser | null): Promise<boolean> {
  if (!user || user.role !== 'owner') return false
  const s = await getAssistantSettings()
  return s.master_profile_ids.includes(user.id)
}

// Provider keys: an env var wins if set, otherwise the encrypted copy the owner
// pasted into Settings. The Anthropic ADMIN key (sk-ant-admin...) is only used to
// read billing -- it is a different key from the one DB thinks with.
export const SECRETS = {
  sarvam: { setting: 'assistant_sarvam_key', env: 'SARVAM_API_KEY' },
  azure: { setting: 'assistant_azure_speech_key', env: 'AZURE_SPEECH_KEY' },
  google: { setting: 'assistant_google_tts_key', env: 'GOOGLE_TTS_API_KEY' },
  anthropic_admin: { setting: 'assistant_anthropic_admin_key', env: 'ANTHROPIC_ADMIN_KEY' },
  // The key DB thinks with. Normally the server's ANTHROPIC_API_KEY (shared with
  // Marketing, bank statements and document extraction); a copy pasted in
  // Settings lets DB work on a server that doesn't have it yet.
  anthropic: { setting: 'assistant_anthropic_api_key', env: 'ANTHROPIC_API_KEY' },
} as const
export type SecretName = keyof typeof SECRETS

export async function getSecret(name: SecretName): Promise<string | null> {
  const fromEnv = process.env[SECRETS[name].env]?.trim()
  if (fromEnv) return fromEnv
  const { data } = await supabaseAdmin.from('app_settings').select('value').eq('key', SECRETS[name].setting).maybeSingle()
  if (!data?.value) return null
  try { return decryptPassword(data.value) } catch { return null }
}

export async function setSecret(name: SecretName, value: string | null, by: string) {
  if (!value) {
    await supabaseAdmin.from('app_settings').delete().eq('key', SECRETS[name].setting)
    return
  }
  await supabaseAdmin.from('app_settings')
    .upsert({ key: SECRETS[name].setting, value: encryptPassword(value.trim()), updated_at: new Date().toISOString(), updated_by: by }, { onConflict: 'key' })
}

// configured: usable here. unreadable: a key is saved but this server can't
// decrypt it -- its PASSWORD_VAULT_KEY is missing or differs from the one the key
// was saved with (e.g. saved on the laptop, read on the live Vercel site).
export async function secretStatus() {
  const out: Record<string, { configured: boolean; from_env: boolean; unreadable: boolean }> = {}
  for (const name of Object.keys(SECRETS) as SecretName[]) {
    const fromEnv = !!process.env[SECRETS[name].env]?.trim()
    if (fromEnv) { out[name] = { configured: true, from_env: true, unreadable: false }; continue }
    const { data } = await supabaseAdmin.from('app_settings').select('value').eq('key', SECRETS[name].setting).maybeSingle()
    let ok = false
    if (data?.value) { try { ok = !!decryptPassword(data.value) } catch { ok = false } }
    out[name] = { configured: ok, from_env: false, unreadable: !!data?.value && !ok }
  }
  return out
}

export const getSarvamKey = () => getSecret('sarvam')
