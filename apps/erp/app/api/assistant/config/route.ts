import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth/session'
import { supabaseAdmin } from '@/lib/supabase/service'
import { logAuditEvent } from '@/lib/audit-log'
import {
  isDbMaster, getAssistantSettings, saveAssistantSettings, getSecret, setSecret, secretStatus,
  ASSISTANT_MODELS, SARVAM_VOICES, VOICE_PROVIDERS, TONES, VOICE_GATES, REPLY_LENGTHS, WRITE_SKILLS, ALL_WRITE_SKILLS, type AssistantSettings, type SecretName, type WriteSkill,
} from '@/lib/assistant/settings'
import { READ_MODULES, ALL_READ_MODULES, type ReadModule } from '@/lib/assistant/reports'
import { cleanAppearance } from '@/components/assistant/appearance'
import { getDbAgentStatus } from '@/lib/assistant/identity'
import { usageSummary, FREE_TTS_CHARS } from '@/lib/assistant/usage'
import { azureFemaleVoices, googleFemaleVoices } from '@/lib/assistant/cloud-voices'
import { anthropicBilling } from '@/lib/assistant/anthropic-billing'
import { liveUsdInr } from '@/lib/assistant/fx'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Settings -> DB Assistant. GET also tells the client whether this user is
// DB's master at all (403 otherwise), which is how the panel button and the
// Settings tab stay hidden from everyone else. `?lite=1` skips the slow parts
// (voice lists, Anthropic billing) for the panel button.
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser || !(await isDbMaster(sessionUser))) return NextResponse.json({ error: 'DB is private to her owner.' }, { status: 403 })
  const [settings, secrets] = await Promise.all([getAssistantSettings(), secretStatus()])
  if (req.nextUrl.searchParams.get('lite')) return NextResponse.json({ settings, secrets })

  const [status, { data: owners }, usage, azureKey, googleKey, adminKey, fx] = await Promise.all([
    getDbAgentStatus(),
    supabaseAdmin.from('profiles').select('id, full_name, username').eq('role', 'owner').eq('is_active', true),
    usageSummary(settings.credit_since),
    getSecret('azure'), getSecret('google'), getSecret('anthropic_admin'), liveUsdInr(),
  ])
  const attempt = async <T,>(fn: () => Promise<T>) => {
    try { return { ok: true as const, data: await fn() } } catch (err) { return { ok: false as const, error: (err as Error).message } }
  }
  const [azureVoices, googleVoices, billing] = await Promise.all([
    azureKey ? attempt(() => azureFemaleVoices(azureKey, settings.azure_region)) : null,
    googleKey ? attempt(() => googleFemaleVoices(googleKey)) : null,
    adminKey ? attempt(() => anthropicBilling(adminKey, settings.credit_since)) : null,
  ])

  return NextResponse.json({
    settings, secrets, status, owners: owners || [], me: sessionUser.id,
    voices: { sarvam: SARVAM_VOICES, azure: azureVoices, google: googleVoices },
    models: ASSISTANT_MODELS,
    read_modules: READ_MODULES,
    write_skills: WRITE_SKILLS,
    // What else in the ERP uses Anthropic (not DB): shown so the two usage
    // meters make sense. Keep in sync with those files.
    other_ai: [
      { feature: 'Bank statement reading (Recon)', model: 'claude-sonnet-5', file: 'lib/recon/ai-extract.ts' },
      { feature: 'Marketing content', model: 'claude-sonnet-5', file: 'lib/marketing/generate.ts' },
      { feature: 'Document / GST news extraction', model: 'claude-sonnet-5', file: 'lib/ai/structured.ts' },
    ],
    usage, free_tts_chars: FREE_TTS_CHARS, fx,
    anthropic_billing: billing,
  })
}

const NUM = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : undefined)
const VOICE_ID = /^[A-Za-z0-9_]{2,40}$/
const KEY_FIELDS: Record<string, SecretName> = { sarvam_key: 'sarvam', azure_key: 'azure', google_key: 'google', anthropic_admin_key: 'anthropic_admin' }

export async function PUT(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser || !(await isDbMaster(sessionUser))) return NextResponse.json({ error: 'DB is private to her owner.' }, { status: 403 })
  const body = await req.json().catch(() => ({}))
  const patch: Partial<AssistantSettings> = {}

  if (Array.isArray(body.master_profile_ids)) {
    const ids = body.master_profile_ids.filter((x: unknown) => typeof x === 'string') as string[]
    if (!ids.includes(sessionUser.id)) return NextResponse.json({ error: 'You can\'t remove yourself — that would lock you out of DB.' }, { status: 400 })
    const { data: owners } = await supabaseAdmin.from('profiles').select('id').eq('role', 'owner').in('id', ids)
    if ((owners || []).length !== ids.length) return NextResponse.json({ error: 'Only owner logins can talk to DB.' }, { status: 400 })
    patch.master_profile_ids = ids
  }
  if (ASSISTANT_MODELS.includes(body.model)) patch.model = body.model
  if (VOICE_PROVIDERS.includes(body.voice_provider)) patch.voice_provider = body.voice_provider
  if (body.listen_provider === 'sarvam' || body.listen_provider === 'browser') patch.listen_provider = body.listen_provider
  if (typeof body.tts_speaker === 'string' && VOICE_ID.test(body.tts_speaker)) patch.tts_speaker = body.tts_speaker
  if (typeof body.azure_voice === 'string' && VOICE_ID.test(body.azure_voice)) patch.azure_voice = body.azure_voice
  if (typeof body.google_voice === 'string' && VOICE_ID.test(body.google_voice)) patch.google_voice = body.google_voice
  if (typeof body.azure_region === 'string' && /^[a-z0-9]{3,30}$/.test(body.azure_region)) patch.azure_region = body.azure_region
  if (NUM(body.tts_pace, 0.7, 1.6) !== undefined) patch.tts_pace = body.tts_pace
  if (typeof body.speak_replies === 'boolean') patch.speak_replies = body.speak_replies
  if (typeof body.wake_word === 'boolean') patch.wake_word = body.wake_word
  if (Array.isArray(body.wake_phrases)) {
    patch.wake_phrases = [...new Set(body.wake_phrases.map((x: unknown) => String(x).toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 40)).filter((x: string) => x.length >= 2 && x.includes(' ')))].slice(0, 30) as string[] // two words or more: a single word ("idbi") wakes her on everyday talk
  }
  if (TONES.includes(body.tone)) patch.tone = body.tone
  if (REPLY_LENGTHS.includes(body.reply_length)) patch.reply_length = body.reply_length
  if (body.appearance && typeof body.appearance === 'object') patch.appearance = cleanAppearance(body.appearance)
  if (typeof body.call_me === 'string') patch.call_me = body.call_me.replace(/[^\p{L}\p{N} .'-]/gu, '').trim().slice(0, 30) || 'Boss'
  if (typeof body.wake_reply === 'string') patch.wake_reply = body.wake_reply.replace(/\s+/g, ' ').trim().slice(0, 60)
  if (Array.isArray(body.write_skills)) patch.write_skills = ALL_WRITE_SKILLS.filter((k) => body.write_skills.includes(k)) as WriteSkill[]
  if (VOICE_GATES.includes(body.voice_gate)) patch.voice_gate = body.voice_gate
  if (typeof body.continuous_conversation === 'boolean') patch.continuous_conversation = body.continuous_conversation
  if (NUM(body.conversation_idle_seconds, 6, 60) !== undefined) patch.conversation_idle_seconds = Math.round(body.conversation_idle_seconds)
  if (Array.isArray(body.read_modules)) patch.read_modules = ALL_READ_MODULES.filter((m) => body.read_modules.includes(m)) as ReadModule[]
  if (body.hinglish_script === 'devanagari' || body.hinglish_script === 'roman') patch.hinglish_script = body.hinglish_script
  if (body.anthropic_credit_usd === null || NUM(body.anthropic_credit_usd, 0, 100000) !== undefined) patch.anthropic_credit_usd = body.anthropic_credit_usd
  if (body.sarvam_credit_inr === null || NUM(body.sarvam_credit_inr, 0, 10000000) !== undefined) patch.sarvam_credit_inr = body.sarvam_credit_inr
  if (body.credit_since === null || (typeof body.credit_since === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.credit_since))) patch.credit_since = body.credit_since

  const keysChanged: string[] = []
  for (const [field, name] of Object.entries(KEY_FIELDS)) {
    if (body[field] === undefined) continue
    const value = typeof body[field] === 'string' && body[field].trim() ? body[field].trim() : null
    if (name === 'anthropic_admin' && value && !value.startsWith('sk-ant-admin')) {
      return NextResponse.json({ error: 'That is not an Admin API key. It starts with "sk-ant-admin" — create one in the Claude Console under Settings → Admin keys.' }, { status: 400 })
    }
    await setSecret(name, value, sessionUser.id)
    keysChanged.push(field)
  }
  const settings = await saveAssistantSettings(patch, sessionUser.id)
  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'update', module: 'settings', tableName: 'app_settings', recordLabel: 'DB assistant settings',
    metadata: { fields: [...Object.keys(patch), ...keysChanged] },
  })
  return NextResponse.json({ settings })
}
