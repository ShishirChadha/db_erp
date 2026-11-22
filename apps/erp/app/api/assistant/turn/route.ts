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
  const text = typeof body.text === 'string' ? body.text.trim().slice(0, 2000) : ''
  if (!text) return NextResponse.json({ error: 'Say something first.' }, { status: 400 })

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
          text,
          spoken: body.spoken === true || typeof body.spoken_language === 'string',
          spokenLanguage: typeof body.spoken_language === 'string' ? body.spoken_language : null,
          interrupted: body.interrupted === true,
          voiceOn: body.voice_on !== false,
          voiceIssue: body.voice_issue === 'blocked' || body.voice_issue === 'failed' ? body.voice_issue : null,
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
