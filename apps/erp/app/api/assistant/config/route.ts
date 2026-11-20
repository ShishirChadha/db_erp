import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth/session'
import { supabaseAdmin } from '@/lib/supabase/service'
import { logAuditEvent } from '@/lib/audit-log'
import {
  isDbMaster, getAssistantSettings, saveAssistantSettings, getSarvamKey, setSarvamKey,
  ASSISTANT_MODELS, SARVAM_VOICES, type AssistantSettings,
} from '@/lib/assistant/settings'
import { getDbAgentStatus } from '@/lib/assistant/identity'
import { usageSummary } from '@/lib/assistant/usage'

export const dynamic = 'force-dynamic'

// Settings -> DB Assistant. GET also tells the client whether this user is
// DB's master at all (403 otherwise), which is how the panel button and the
// Settings tab stay hidden from everyone else.
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser || !(await isDbMaster(sessionUser))) return NextResponse.json({ error: 'DB is private to her owner.' }, { status: 403 })
  const [settings, key, status, { data: owners }] = await Promise.all([
    getAssistantSettings(),
    getSarvamKey(),
    getDbAgentStatus(),
    supabaseAdmin.from('profiles').select('id, full_name, username').eq('role', 'owner').eq('is_active', true),
  ])
  const usage = await usageSummary(settings.credit_since)
  return NextResponse.json({
    settings,
    sarvam_key_configured: !!key,
    sarvam_key_from_env: !!process.env.SARVAM_API_KEY?.trim(),
    status,
    owners: owners || [],
    me: sessionUser.id,
    voices: SARVAM_VOICES,
    models: ASSISTANT_MODELS,
    usage,
  })
}

const NUM = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : undefined)

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
  if (body.voice_provider === 'sarvam' || body.voice_provider === 'browser') patch.voice_provider = body.voice_provider
  if (typeof body.tts_speaker === 'string' && /^[a-z0-9_]{2,40}$/.test(body.tts_speaker)) patch.tts_speaker = body.tts_speaker
  if (NUM(body.tts_pace, 0.7, 1.6) !== undefined) patch.tts_pace = body.tts_pace
  if (typeof body.speak_replies === 'boolean') patch.speak_replies = body.speak_replies
  if (typeof body.wake_word === 'boolean') patch.wake_word = body.wake_word
  if (Array.isArray(body.wake_phrases)) {
    patch.wake_phrases = body.wake_phrases.map((x: unknown) => String(x).toLowerCase().trim()).filter((x: string) => x.length >= 2).slice(0, 10)
  }
  if (body.hinglish_script === 'devanagari' || body.hinglish_script === 'roman') patch.hinglish_script = body.hinglish_script
  if (body.anthropic_credit_usd === null || NUM(body.anthropic_credit_usd, 0, 100000) !== undefined) patch.anthropic_credit_usd = body.anthropic_credit_usd
  if (body.sarvam_credit_inr === null || NUM(body.sarvam_credit_inr, 0, 10000000) !== undefined) patch.sarvam_credit_inr = body.sarvam_credit_inr
  if (body.credit_since === null || (typeof body.credit_since === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.credit_since))) patch.credit_since = body.credit_since
  if (NUM(body.usd_inr, 50, 200) !== undefined) patch.usd_inr = body.usd_inr

  if (body.sarvam_key !== undefined) {
    await setSarvamKey(typeof body.sarvam_key === 'string' && body.sarvam_key.trim() ? body.sarvam_key : null, sessionUser.id)
  }
  const settings = await saveAssistantSettings(patch, sessionUser.id)
  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'update', module: 'settings', tableName: 'app_settings', recordLabel: 'DB assistant settings',
    metadata: { fields: [...Object.keys(patch), ...(body.sarvam_key !== undefined ? ['sarvam_key'] : [])] },
  })
  return NextResponse.json({ settings })
}
