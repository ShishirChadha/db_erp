import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth/session'
import { isDbMaster } from '@/lib/assistant/settings'
import { getDbAgentStatus } from '@/lib/assistant/identity'
import { runAssistantTurn, type TurnEvent } from '@/lib/assistant/loop'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// One turn with DB, streamed back as server-sent events so the panel can start
// speaking her reply while she is still finishing it. Only DB's master (set in
// Settings -> DB Assistant) can talk to her; her answers include cost and margin.
export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser || !(await isDbMaster(sessionUser))) return NextResponse.json({ error: 'DB is private to her owner.' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  // A photo: base64 of a JPEG/PNG/WebP the panel resized (≤1600 px). ~2 MB cap
  // keeps the request under the hosting limit and the token cost to ~1,600.
  const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
  const rawImage = body.image && typeof body.image === 'object' ? body.image : null
  const image = rawImage && IMAGE_TYPES.includes(rawImage.media_type) && typeof rawImage.data === 'string' && /^[A-Za-z0-9+/=]+$/.test(rawImage.data)
    ? { data: rawImage.data as string, media_type: rawImage.media_type as (typeof IMAGE_TYPES)[number] }
    : null
  if (rawImage && !image) return NextResponse.json({ error: 'That photo could not be read. Use a JPEG or PNG.' }, { status: 400 })
  if (image && image.data.length > 2_800_000) return NextResponse.json({ error: 'That photo is too big. Try again (it is shrunk automatically) or crop it.' }, { status: 413 })
  const text = typeof body.text === 'string' ? body.text.trim().slice(0, 2000) : ''
  if (!text && !image) return NextResponse.json({ error: 'Say something first.' }, { status: 400 })

  const status = await getDbAgentStatus()
  if (!status.ready) {
    const why = { not_set_up: 'DB is not set up yet.', deactivated: 'DB is deactivated in Users.', logged_off: 'DB is logged off (Active Devices).' }[status.reason]
    return NextResponse.json({ error: why, reason: status.reason }, { status: 409 })
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: TurnEvent) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`))
      try {
        await runAssistantTurn({
          threadId: typeof body.thread_id === 'string' ? body.thread_id : null,
          owner: { id: sessionUser.id, email: sessionUser.email },
          db: { profileId: status.profileId, sessionId: status.sessionId },
          text: text || '(no words, only the photo)',
          spoken: body.spoken === true || typeof body.spoken_language === 'string',
          spokenLanguage: typeof body.spoken_language === 'string' ? body.spoken_language : null,
          interrupted: body.interrupted === true,
          voiceOn: body.voice_on !== false,
          voiceIssue: body.voice_issue === 'blocked' || body.voice_issue === 'failed' ? body.voice_issue : null,
          confirmActionId: typeof body.confirm_action_id === 'string' ? body.confirm_action_id : null,
          image,
          emit,
        })
      } catch (err) {
        emit({ type: 'error', message: (err as Error).message })
        emit({ type: 'done' })
      } finally {
        controller.close()
      }
    },
  })
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform' } })
}
