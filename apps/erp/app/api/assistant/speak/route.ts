import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth/session'
import { isDbMaster, getAssistantSettings, getSecret, VOICE_PROVIDERS, type VoiceProvider } from '@/lib/assistant/settings'
import { synthesize, TTS_MODEL } from '@/lib/assistant/sarvam'
import { azureSynthesize, googleSynthesize } from '@/lib/assistant/cloud-voices'
import { recordSarvamUsage, recordFreeTtsUsage } from '@/lib/assistant/usage'

export const dynamic = 'force-dynamic'
export const maxDuration = 40

// DB's reply text -> her voice (mp3, base64), from whichever provider Settings
// picked. `provider` / `voice` / `pace` may be passed to preview a voice before
// saving it.
export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser || !(await isDbMaster(sessionUser))) return NextResponse.json({ error: 'DB is private to her owner.' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const text = typeof body.text === 'string' ? body.text.trim() : ''
  if (!text) return NextResponse.json({ error: 'Nothing to say.' }, { status: 400 })
  const settings = await getAssistantSettings()
  const provider: VoiceProvider = VOICE_PROVIDERS.includes(body.provider) ? body.provider : settings.voice_provider
  const voiceArg = typeof body.voice === 'string' && /^[A-Za-z0-9_]{2,40}$/.test(body.voice) ? body.voice : null
  const pace = typeof body.pace === 'number' ? Math.min(1.6, Math.max(0.7, body.pace)) : settings.tts_pace
  if (provider === 'browser') return NextResponse.json({ error: 'Browser voice plays on the device.' }, { status: 400 })

  const key = await getSecret(provider)
  const names = { sarvam: 'Sarvam', azure: 'Azure', google: 'Google' }
  if (!key) return NextResponse.json({ error: `Add the ${names[provider]} key in Settings → DB Assistant.` }, { status: 409 })
  try {
    if (provider === 'sarvam') {
      const out = await synthesize(key, text, voiceArg || settings.tts_speaker, pace)
      await recordSarvamUsage({ profileId: sessionUser.id, kind: 'tts', usdInr: settings.usd_inr, characters: out.characters, model: TTS_MODEL })
      return NextResponse.json({ audio: out.audio, format: 'mp3' })
    }
    if (provider === 'azure') {
      const out = await azureSynthesize(key, settings.azure_region, voiceArg || settings.azure_voice, text, pace)
      await recordFreeTtsUsage({ profileId: sessionUser.id, provider: 'azure_tts', model: voiceArg || settings.azure_voice, characters: out.characters })
      return NextResponse.json({ audio: out.audio, format: 'mp3' })
    }
    const out = await googleSynthesize(key, voiceArg || settings.google_voice, text, pace)
    await recordFreeTtsUsage({ profileId: sessionUser.id, provider: 'google_tts', model: voiceArg || settings.google_voice, characters: out.characters })
    return NextResponse.json({ audio: out.audio, format: 'mp3' })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 })
  }
}
