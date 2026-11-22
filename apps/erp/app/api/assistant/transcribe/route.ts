import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth/session'
import { isDbMaster, getAssistantSettings, getSarvamKey, getSecret } from '@/lib/assistant/settings'
import { transcribe, STT_MODEL } from '@/lib/assistant/sarvam'
import { azureTranscribe } from '@/lib/assistant/cloud-voices'
import { liveUsdInr } from '@/lib/assistant/fx'
import { recordSarvamUsage, recordFreeSttUsage } from '@/lib/assistant/usage'

export const dynamic = 'force-dynamic'
export const maxDuration = 40

// The owner's voice clip -> text. provider=azure: 16 kHz WAV recorded by the
// panel (used when the browser can't recognise speech itself, e.g. DuckDuckGo
// on Android), free within Azure's F0 tier. Otherwise Sarvam (webm/mp4 clip).
export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser || !(await isDbMaster(sessionUser))) return NextResponse.json({ error: 'DB is private to her owner.' }, { status: 403 })
  const form = await req.formData()
  const audio = form.get('audio')
  if (!(audio instanceof Blob) || audio.size === 0) return NextResponse.json({ error: 'No audio received.' }, { status: 400 })
  if (audio.size > 3_000_000) return NextResponse.json({ error: 'That clip is too long.' }, { status: 413 })
  const seconds = Math.min(60, Math.max(1, Number(form.get('seconds')) || 1))
  const settings = await getAssistantSettings()

  try {
    if (form.get('provider') === 'azure') {
      const key = await getSecret('azure')
      if (!key) return NextResponse.json({ error: 'Add the Azure Speech key in Settings → DB Assistant.' }, { status: 409 })
      const result = await azureTranscribe(key, settings.azure_region, await audio.arrayBuffer(), settings.azure_stt_language)
      await recordFreeSttUsage({ profileId: sessionUser.id, provider: 'azure_stt', model: `azure-stt-${settings.azure_stt_language}`, seconds })
      // Azure transcribes in the configured language; it detects nothing. Sending
      // that code as "detected" told DB every Hinglish sentence was English, so
      // no language goes back and she judges from the words (as with the browser).
      return NextResponse.json({ text: result.text, language: null })
    }
    const key = await getSarvamKey()
    if (!key) return NextResponse.json({ error: 'Add the Sarvam API key in Settings → DB Assistant.' }, { status: 409 })
    const result = await transcribe(key, audio, (audio as File).name || 'speech.webm')
    await recordSarvamUsage({ profileId: sessionUser.id, kind: 'stt', usdInr: (await liveUsdInr()).rate, seconds, model: STT_MODEL })
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 })
  }
}
