import { supabaseAdmin } from '@/lib/supabase/service'
import { encryptPassword, decryptPassword } from '@/lib/auth/password-vault'
import type { SessionUser } from '@/lib/auth/session'

// Everything the owner can change about DB, in one app_settings row
// (assistant_settings, JSON). app_settings has RLS on with no policies, so only
// the service role reads it; the Sarvam key is additionally encrypted with the
// same vault that keeps staff passwords.
export const ASSISTANT_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5'] as const
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

export interface AssistantSettings {
  master_profile_ids: string[]
  model: AssistantModel
  voice_provider: 'sarvam' | 'browser'
  tts_speaker: string
  tts_pace: number
  speak_replies: boolean
  wake_word: boolean
  wake_phrases: string[]
  hinglish_script: 'devanagari' | 'roman'
  anthropic_credit_usd: number | null
  sarvam_credit_inr: number | null
  credit_since: string | null // spend is counted from this date
  usd_inr: number
}

export const DEFAULT_SETTINGS: AssistantSettings = {
  master_profile_ids: [],
  model: 'claude-opus-5-5',
  voice_provider: 'sarvam',
  tts_speaker: 'simran_enhi_customer',
  tts_pace: 1.05,
  speak_replies: true,
  wake_word: false,
  wake_phrases: ['hey db', 'hi db', 'db suno', 'suno db', 'hello db'],
  hinglish_script: 'devanagari',
  anthropic_credit_usd: null,
  sarvam_credit_inr: null,
  credit_since: null,
  usd_inr: 88,
}

const KEY = 'assistant_settings'
const SARVAM_KEY = 'assistant_sarvam_key'

export async function getAssistantSettings(): Promise<AssistantSettings> {
  const { data } = await supabaseAdmin.from('app_settings').select('value').eq('key', KEY).maybeSingle()
  let stored: Partial<AssistantSettings> = {}
  try { stored = data?.value ? JSON.parse(data.value) : {} } catch { stored = {} }
  return { ...DEFAULT_SETTINGS, ...stored }
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

export async function getSarvamKey(): Promise<string | null> {
  const fromEnv = process.env.SARVAM_API_KEY?.trim()
  if (fromEnv) return fromEnv
  const { data } = await supabaseAdmin.from('app_settings').select('value').eq('key', SARVAM_KEY).maybeSingle()
  if (!data?.value) return null
  try { return decryptPassword(data.value) } catch { return null }
}

export async function setSarvamKey(key: string | null, by: string) {
  if (!key) {
    await supabaseAdmin.from('app_settings').delete().eq('key', SARVAM_KEY)
    return
  }
  await supabaseAdmin.from('app_settings')
    .upsert({ key: SARVAM_KEY, value: encryptPassword(key.trim()), updated_at: new Date().toISOString(), updated_by: by }, { onConflict: 'key' })
}
