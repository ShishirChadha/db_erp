import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth/session'
import { isDbMaster, getAssistantSettings, getSarvamKey } from '@/lib/assistant/settings'
import { transcribe, STT_MODEL } from '@/lib/assistant/sarvam'
import { liveUsdInr } from '@/lib/assistant/fx'
import { recordSarvamUsage } from '@/lib/assistant/usage'

export const dynamic = 'force-dynamic'
export const maxDuration = 40

// The owner's voice clip (max ~30s, browser MediaRecorder) -> text, via Sarvam.
export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser || !(await isDbMaster(sessionUser))) return NextResponse.json({ error: 'DB is private to her owner.' }, { status: 403 })
  const key = await getSarvamKey()
  if (!key) return NextResponse.json({ error: 'Add the Sarvam API key in Settings → DB Assistant.' }, { status: 409 })

  const form = await req.formData()
  const audio = form.get('audio')
  if (!(audio instanceof Blob) || audio.size === 0) return NextResponse.json({ error: 'No audio received.' }, { status: 400 })
  const seconds = Math.min(60, Math.max(1, Number(form.get('seconds')) || 1))
  try {
    const result = await transcribe(key, audio, (audio as File).name || 'speech.webm')
    const settings = await getAssistantSettings()
    await recordSarvamUsage({ profileId: sessionUser.id, kind: 'stt', usdInr: (await liveUsdInr()).rate, seconds, model: STT_MODEL })
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 })
  }
}
