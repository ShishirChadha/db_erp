import Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from '@/lib/supabase/service'
import { istToday } from '@/lib/attendance'
import { ASSISTANT_SYSTEM_PROMPT } from './playbooks'
import { ASSISTANT_TOOLS, runTool, type AssistantCard, type PendingAction } from './tools'

// One conversational turn with DB: the owner's words in, DB's reply (streamed)
// plus any confirmation / done / share cards out. A manual tool loop on the
// Messages API rather than the SDK's tool runner, because the turn's state --
// the full history and the one pending write -- has to be saved to
// assistant_threads between turns (a serverless function remembers nothing),
// and confirm_pending_action needs to know which turn a proposal came from.
export const ASSISTANT_MODEL = 'claude-opus-5-5'
const MAX_STEPS = 10

export type TurnEvent =
  | { type: 'thread'; id: string }
  | { type: 'text'; delta: string }
  | { type: 'status'; tool: string }
  | { type: 'card'; card: AssistantCard }
  | { type: 'error'; message: string }
  | { type: 'done' }

interface ThreadRow {
  id: string
  messages: Anthropic.Beta.BetaMessageParam[]
  pending_action: PendingAction | null
  title: string | null
}

export async function runAssistantTurn(params: {
  threadId: string | null
  owner: { id: string; email: string | undefined }
  db: { profileId: string; sessionId: string }
  text: string
  emit: (e: TurnEvent) => void
}) {
  const { owner, db, emit } = params
  const thread = await loadOrCreateThread(params.threadId, owner.id, params.text)
  emit({ type: 'thread', id: thread.id })

  const messages = thread.messages
  let pending = thread.pending_action
  // A "turn" is one owner message; proposals remember which turn made them.
  const turn = messages.filter((m) => m.role === 'user' && typeof m.content === 'string').length + 1
  const today = istToday()
  const weekday = new Date(`${today}T12:00:00+05:30`).toLocaleDateString('en-IN', { weekday: 'long', timeZone: 'Asia/Kolkata' })
  messages.push({ role: 'user', content: `[${weekday}, ${today}${pending ? ` | pending action ${pending.id}: ${pending.summary.replace(/\n/g, '; ')}` : ''}]\n${params.text}` })

  const client = new Anthropic()
  let spoke = false
  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const stream = client.beta.messages.stream({
        model: ASSISTANT_MODEL,
        max_tokens: 8000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'low' },
        // Tools + system are identical every turn, so they are cached; the
        // top-level breakpoint also caches the growing history between steps.
        cache_control: { type: 'ephemeral' },
        system: [{ type: 'text', text: ASSISTANT_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        tools: ASSISTANT_TOOLS,
        messages,
      })
      // Text from separate steps (before and after a tool call) arrives as
      // separate blocks; keep a space between them so sentences don't run together.
      let firstDelta = true
      stream.on('text', (delta) => {
        emit({ type: 'text', delta: firstDelta && spoke ? ` ${delta}` : delta })
        firstDelta = false
        spoke = true
      })
      const message = await stream.finalMessage()
      messages.push({ role: 'assistant', content: message.content as Anthropic.Beta.BetaContentBlockParam[] })

      if (message.stop_reason === 'refusal') {
        emit({ type: 'text', delta: 'Sorry Shishir, ye main nahi kar sakti.' })
        break
      }
      const toolUses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use')
      if (toolUses.length === 0 || message.stop_reason === 'max_tokens') break

      const results: Anthropic.Beta.BetaToolResultBlockParam[] = []
      for (const use of toolUses) {
        emit({ type: 'status', tool: use.name })
        const outcome = await runTool(use.name, use.input, { ownerId: owner.id, ownerEmail: owner.email, turn, pending, db })
        if (outcome.pending !== undefined) pending = outcome.pending
        if (outcome.card) emit({ type: 'card', card: outcome.card })
        results.push({
          type: 'tool_result',
          tool_use_id: use.id,
          is_error: outcome.isError || undefined,
          content: typeof outcome.result === 'string' ? outcome.result : JSON.stringify(outcome.result),
        })
      }
      messages.push({ role: 'user', content: results })
    }
  } catch (err) {
    emit({ type: 'error', message: err instanceof Anthropic.APIError ? `AI service error (${err.status}). Try again in a moment.` : (err as Error).message })
  } finally {
    await supabaseAdmin.from('assistant_threads')
      .update({ messages, pending_action: pending, updated_at: new Date().toISOString() })
      .eq('id', thread.id)
    emit({ type: 'done' })
  }
}

async function loadOrCreateThread(threadId: string | null, ownerId: string, firstText: string): Promise<ThreadRow> {
  if (threadId) {
    const { data } = await supabaseAdmin.from('assistant_threads')
      .select('id, messages, pending_action, title').eq('id', threadId).eq('owner_id', ownerId).maybeSingle()
    if (data) return data as ThreadRow
  }
  const { data, error } = await supabaseAdmin.from('assistant_threads')
    .insert({ owner_id: ownerId, title: firstText.slice(0, 80) })
    .select('id, messages, pending_action, title').single()
  if (error || !data) throw new Error(error?.message || 'Could not start a conversation.')
  return data as ThreadRow
}

// The conversation as the panel shows it: owner's words and DB's spoken text,
// without tool plumbing or the date prefix.
export function visibleTranscript(messages: Anthropic.Beta.BetaMessageParam[]) {
  const out: { role: 'owner' | 'db'; text: string }[] = []
  for (const m of messages) {
    if (m.role === 'user' && typeof m.content === 'string') out.push({ role: 'owner', text: m.content.replace(/^\[[^\]]*\]\n/, '') })
    else if (m.role === 'assistant' && Array.isArray(m.content)) {
      const text = m.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join(' ').trim()
      if (text) out.push({ role: 'db', text })
    }
  }
  return out
}
