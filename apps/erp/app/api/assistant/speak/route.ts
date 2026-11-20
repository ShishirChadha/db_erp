import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth/session'
import { isDbMaster, getAssistantSettings, getSarvamKey } from '@/lib/assistant/settings'
import { synthesize, TTS_MODEL } from '@/lib/assistant/sarvam'
import { recordSarvamUsage } from '@/lib/assistant/usage'

export const dynamic = 'force-dynamic'
export const maxDuration = 40

// DB's reply text -> her voice (mp3, base64). `speaker`/`pace` may be passed to
// preview a voice from Settings before saving it.
export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser || !(await isDbMaster(sessionUser))) return NextResponse.json({ error: 'DB is private to her owner.' }, { status: 403 })
  const key = await getSarvamKey()
  if (!key) return NextResponse.json({ error: 'Add the Sarvam API key in Settings → DB Assistant.' }, { status: 409 })

  const body = await req.json().catch(() => ({}))
  const text = typeof body.text === 'string' ? body.text.trim() : ''
  if (!text) return NextResponse.json({ error: 'Nothing to say.' }, { status: 400 })
  const settings = await getAssistantSettings()
  const speaker = typeof body.speaker === 'string' && /^[a-z0-9_]{2,40}$/.test(body.speaker) ? body.speaker : settings.tts_speaker
  const pace = typeof body.pace === 'number' ? Math.min(1.6, Math.max(0.7, body.pace)) : settings.tts_pace
  try {
    const out = await synthesize(key, text, speaker, pace)
    await recordSarvamUsage({ profileId: sessionUser.id, kind: 'tts', usdInr: settings.usd_inr, characters: out.characters, model: TTS_MODEL })
    return NextResponse.json({ audio: out.audio, format: 'mp3' })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 })
  }
}
