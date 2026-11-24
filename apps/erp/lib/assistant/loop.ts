import Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from '@/lib/supabase/service'
import { istToday } from '@/lib/attendance'
import { assistantSystemPrompt } from './playbooks'
import { getAssistantSettings, getSecret } from './settings'
import { recordClaudeUsage } from './usage'
import { liveUsdInr } from './fx'
import { isPlainYes } from './approval'
import { assistantTools, runTool, type AssistantCard, type PendingAction } from './tools'

// One conversational turn with DB: the owner's words in, DB's reply (streamed)
// plus any confirmation / done / share cards out. A manual tool loop on the
// Messages API rather than the SDK's tool runner, because the turn's state --
// the full history and the one pending write -- has to be saved to
// assistant_threads between turns (a serverless function remembers nothing),
// and confirm_pending_action needs to know which turn a proposal came from.
const MAX_STEPS = 10

export type TurnEvent =
  // fresh: the old conversation was idle for over an hour, so this one is new.
  | { type: 'thread'; id: string; fresh?: boolean }
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
  // He used her microphone (false = typed).
  spoken?: boolean
  // BCP-47 code Sarvam/Azure detected when he spoke; null when typed or when
  // the browser recogniser (which detects no language) heard him.
  spokenLanguage?: string | null
  // He stopped her reply aloud before it finished; he didn't hear the rest.
  interrupted?: boolean
  // He muted her voice on this device (he reads her replies).
  voiceOn?: boolean
  // Her previous reply's voice never reached him on this device.
  voiceIssue?: 'blocked' | 'failed' | null
  // He tapped Confirm on this pending card (the panel sends its id).
  confirmActionId?: string | null
  emit: (e: TurnEvent) => void
}) {
  const { owner, db, emit } = params
  const apiKey = await getSecret('anthropic')
  if (!apiKey) {
    emit({ type: 'error', message: 'DB’s brain has no Anthropic API key on this server. Add ANTHROPIC_API_KEY in Vercel (erp project → Settings → Environment Variables, then redeploy), or paste the key in Settings → DB Assistant → Brain.' })
    emit({ type: 'done' })
    return
  }
  let settings = await getAssistantSettings()
  const thread = await loadOrCreateThread(params.threadId, owner.id, params.text, settings.fresh_after_break)
  emit({ type: 'thread', id: thread.id, ...(thread.fresh ? { fresh: true } : {}) })

  const messages = thread.messages
  let pending = thread.pending_action
  // A "turn" is one owner message; proposals remember which turn made them.
  const turn = messages.filter((m) => m.role === 'user' && typeof m.content === 'string').length + 1
  const today = istToday()
  const weekday = new Date(`${today}T12:00:00+05:30`).toLocaleDateString('en-IN', { weekday: 'long', timeZone: 'Asia/Kolkata' })
  const how = params.spokenLanguage
    ? `spoken, detected ${params.spokenLanguage}${params.spokenLanguage === 'en-IN' ? ' (English)' : ' (Hindi/Hinglish)'}`
    : params.spoken ? 'spoken' : 'typed'
  const voiceNote = params.voiceOn === false
    ? ' | your voice is muted on his device; he reads your replies'
    : params.voiceIssue === 'blocked'
      ? ' | your last reply was silent on his device: the browser blocked the sound until a tap on the page'
      : params.voiceIssue === 'failed'
        ? ' | your last reply was silent on his device: it could not play the sound'
        : ''
  messages.push({ role: 'user', content: `[${weekday}, ${today} | ${how}${params.interrupted ? ' | he stopped your last reply midway; he did not hear all of it' : ''}${voiceNote}${pending ? ` | pending action ${pending.id}: ${pending.summary.replace(/\n/g, '; ')}` : ''}]\n${params.text}` })

  // His approval of the pending card, decided in code from his own words or
  // tap -- never from anything the model reads (lib/assistant/approval.ts).
  const approval = {
    tappedActionId: params.confirmActionId || null,
    saidYes: isPlainYes(params.text, settings.call_me),
    tapOnlyMoney: settings.tap_to_confirm_money,
  }

  const client = new Anthropic({ apiKey })
  let tools = assistantTools(settings.read_modules, settings.write_skills)
  const [fx, learnings] = await Promise.all([liveUsdInr(), generalLearnings()])
  const usdInr = fx.rate
  let system = assistantSystemPrompt(settings.hinglish_script, settings.tone, settings.reply_length, settings.write_skills, settings.call_me)
  // Thinking blocks are sealed to the exact prompt they were made with. Any
  // change to her instructions, settings, learnings or model would otherwise
  // make Anthropic reject the whole saved conversation with a 400 ("Invalid
  // signature in thinking block ... bound to a different conversation"), as
  // happened on 2026-11-21 -- so stale blocks are dropped instead.
  // Haiku 5.5 has no server-side fallback model; only ask for one elsewhere.
  const isHaiku = settings.model === 'claude-haiku-5-5'
  const requestExtras = {
    betas: ['thinking-binding-controls-2026-08-01', ...(isHaiku ? [] : ['server-side-fallback-2026-07-01'])],
    ...(isHaiku ? {} : { fallbacks: 'default' as const }),
    thinking: { type: 'adaptive', block_binding: { prefix_mismatch_behavior: 'drop_block' } },
  }
  let answered = false // at least one model response this turn
  let spoke = false
  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const stream = client.beta.messages.stream({
        model: settings.model,
        max_tokens: 8000,
        ...(requestExtras as any),
        output_config: { effort: 'low' },
        // Tools + system are identical every turn: cached for 1 HOUR (owner's
        // choice) -- he talks to DB on and off through the day, and with a
        // 5-minute cache most first messages re-wrote ~11k tokens (~Rs 2.5).
        // A 1h write costs 2x input instead of 1.25x, so it pays off whenever
        // there is more than one conversation an hour.
        // The growing history (tool results, replies) keeps the default
        // 5-minute cache: it is only re-read within the same conversation, and
        // writing big report results at the 2x rate cost more than it saved.
        // (Order is valid: the longer-TTL breakpoint comes first.)
        cache_control: { type: 'ephemeral' },
        // General learnings come after the cached block: editing one never
        // invalidates the 1-hour cache of her instructions.
        system: [
          { type: 'text', text: system, cache_control: { type: 'ephemeral', ttl: '1h' } },
          ...(learnings ? [{ type: 'text' as const, text: learnings }] : []),
        ],
        tools,
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
      answered = true
      await recordClaudeUsage({ profileId: owner.id, threadId: thread.id, model: message.model || settings.model, usdInr, usage: message.usage })
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
        const outcome = await runTool(use.name, use.input, { ownerId: owner.id, ownerEmail: owner.email, turn, pending, db, modules: settings.read_modules, skills: settings.write_skills, approval })
        if (outcome.pending !== undefined) pending = outcome.pending
        if (outcome.card) emit({ type: 'card', card: outcome.card })
        // He just allowed a skill: give her its tools and the updated
        // instructions for the rest of this turn (a one-off cache miss).
        if (outcome.settingsChanged) {
          settings = await getAssistantSettings()
          tools = assistantTools(settings.read_modules, settings.write_skills)
          system = assistantSystemPrompt(settings.hinglish_script, settings.tone, settings.reply_length, settings.write_skills, settings.call_me)
        }
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
    console.error('[assistant] turn failed:', err)
    // Nothing was answered: don't keep his message in the saved conversation,
    // or a request Anthropic rejects would be re-sent (and rejected) forever.
    if (!answered) messages.pop()
    const detail = err instanceof Anthropic.APIError ? String((err as any).error?.error?.message || err.message).slice(0, 180) : ''
    emit({
      type: 'error',
      message: err instanceof Anthropic.APIError
        ? `AI service error (${err.status}). ${err.status && err.status >= 500 || err.status === 429 ? 'Try again in a moment.' : 'If it repeats, start a new conversation with the + button.'}${detail ? ` (${detail})` : ''}`
        : (err as Error).message,
    })
  } finally {
    await supabaseAdmin.from('assistant_threads')
      .update({ messages, pending_action: pending, updated_at: new Date().toISOString() })
      .eq('id', thread.id)
    emit({ type: 'done' })
  }
}

// The owner's general learnings (Settings -> DB's learnings), applied on every
// turn. Customer-specific ones arrive with find_customer instead.
async function generalLearnings(): Promise<string | null> {
  const { data } = await supabaseAdmin.from('assistant_notes').select('note')
    .eq('is_active', true).eq('subject_type', 'general').order('created_at', { ascending: true }).limit(60)
  if (!data?.length) return null
  return `## What Shishir has taught you (always follow these; they override your defaults)\n${data.map((n) => `- ${n.note}`).join('\n')}`
}

// Same length as her instruction cache (1 h): past it, the old chat would be
// re-cached in full at the next reply and re-read on every one after.
const FRESH_AFTER_MS = 60 * 60 * 1000

export async function loadOrCreateThread(threadId: string | null, ownerId: string, firstText: string, freshAfterBreak: boolean): Promise<ThreadRow & { fresh?: boolean }> {
  let fresh = false
  if (threadId) {
    const { data } = await supabaseAdmin.from('assistant_threads')
      .select('id, messages, pending_action, title, updated_at').eq('id', threadId).eq('owner_id', ownerId).maybeSingle()
    if (data) {
      const { updated_at: updatedAt, ...row } = data as ThreadRow & { updated_at: string }
      const idle = Date.now() - new Date(updatedAt).getTime() > FRESH_AFTER_MS
      // A card still waiting for his yes keeps the conversation open.
      if (!freshAfterBreak || !idle || row.pending_action || !row.messages.length) return row
      fresh = true
    }
  }
  const { data, error } = await supabaseAdmin.from('assistant_threads')
    .insert({ owner_id: ownerId, title: firstText.slice(0, 80) })
    .select('id, messages, pending_action, title').single()
  if (error || !data) throw new Error(error?.message || 'Could not start a conversation.')
  return { ...(data as ThreadRow), fresh }
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
