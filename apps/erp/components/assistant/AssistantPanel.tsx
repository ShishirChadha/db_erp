'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Mic, Square, Send, Volume2, VolumeX, Plus, X, ExternalLink, MessageCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { apiFetch } from '@/lib/api-client'
import { cn } from '@/lib/utils'
import { useVoice, useWakeWord, type SpeakProvider, type VoiceGate, type NothingReason, type Dropped } from './useVoice'
import { DbAvatar, type AvatarState } from './DbAvatar'

// DB, the owner's voice secretary. Her button (her face) floats on every
// dashboard page. On a laptop the panel docks beside the ERP so both stay
// usable; on a phone it opens full screen.
//
// Conversation mode: tap the mic once (or say "Hey DB") and talk normally --
// after each reply she listens again by herself. It ends when you go quiet for
// the configured seconds, say "bas"/"bye"/"thanks", tap End, or close the
// panel. Quiet / far-away speech and fillers are ignored (see useVoice).

type Card =
  | { type: 'confirm'; action_id: string; title: string; summary: string; warnings: string[] }
  | { type: 'done'; title: string; detail: string; link?: string | null }
  | { type: 'share'; title: string; pdf_url: string; whatsapp_to_customer: string | null; whatsapp_pick_chat: string }

type Entry = { role: 'owner' | 'db'; text: string; cards?: Card[] }

const THREAD_KEY = 'db_assistant_thread'
const STATUS_WORDS: Record<string, string> = {
  find_customer: 'Customer dekh rahi hoon…',
  find_products: 'Stock check kar rahi hoon…',
  find_sellable_units: 'Units dekh rahi hoon…',
  find_unit_by_serial: 'Serial dhoondh rahi hoon…',
  price_context: 'Purane rates dekh rahi hoon…',
  confirm_pending_action: 'Save kar rahi hoon…',
  share_document_on_whatsapp: 'PDF bana rahi hoon…',
  stock_overview: 'Stock dekh rahi hoon…',
  sold_stock: 'Sales dekh rahi hoon…',
  sales_report: 'Report bana rahi hoon…',
  payments_due: 'Dues check kar rahi hoon…',
  customer_history: 'Customer ki history dekh rahi hoon…',
  repair_jobs: 'Repair jobs dekh rahi hoon…',
  rentals_status: 'Rentals dekh rahi hoon…',
  purchases_report: 'Purchases dekh rahi hoon…',
  expenses_report: 'Expenses dekh rahi hoon…',
  tasks: 'Tasks dekh rahi hoon…',
}
const SUGGESTIONS = [
  'Aaj ki sale kitni hui?',
  'Kitne laptop ready for sale hain?',
  'Kiske payments due hain?',
  'Open repair jobs kitne hain?',
  'Ek PI banana hai',
]
// Saying one of these ends conversation mode after her reply.
const END_RE = /^(ok |okay |achha |theek hai )?(bas|bas itna|bas itna hi|that'?s all|that is all|bye|bye bye|ok bye|chalo bye|thank you|thanks|thank you db|thanks db|shukriya|dhanyawad|good night)( db)?[.!? ]*$/i

function readStore(key: string) { try { return localStorage.getItem(key) } catch { return null } }
function writeStore(key: string, value: string | null) {
  try { value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value) } catch { /* private mode */ }
}

interface PanelConfig {
  listen: 'sarvam' | 'browser'
  speak: SpeakProvider
  speakReplies: boolean
  wakeWord: boolean
  wakePhrases: string[]
  continuous: boolean
  idleSeconds: number
  gate: VoiceGate
}

// Shown only to DB's master: /api/assistant/config answers 403 for anyone
// else (other owners included), and then nothing renders at all.
export function AssistantLauncher() {
  const [config, setConfig] = useState<PanelConfig | null>(null)
  const [open, setOpen] = useState(false)
  const [wakeKey, setWakeKey] = useState(0)
  const [busyVoice, setBusyVoice] = useState(false)
  const [externalPause, setExternalPause] = useState(false)

  const load = useCallback(() => {
    apiFetch('/api/assistant/config?lite=1').then(async (r) => {
      if (!r.ok) { setConfig(null); return }
      const j = await r.json()
      const s = j.settings
      const vp = s.voice_provider as SpeakProvider
      setConfig({
        // A provider whose key isn't saved yet falls back to the browser.
        listen: s.listen_provider === 'sarvam' && j.secrets.sarvam?.configured ? 'sarvam' : 'browser',
        speak: vp !== 'browser' && j.secrets[vp]?.configured ? vp : 'browser',
        speakReplies: s.speak_replies,
        wakeWord: s.wake_word,
        wakePhrases: s.wake_phrases,
        continuous: s.continuous_conversation !== false,
        idleSeconds: Number(s.conversation_idle_seconds) || 15,
        gate: s.voice_gate || 'medium',
      })
    }).catch(() => setConfig(null))
  }, [])
  useEffect(() => {
    load()
    const onChange = () => load()
    // Settings -> "Teach DB her name" needs the mic to itself for a moment.
    const onPause = (e: Event) => setExternalPause(!!(e as CustomEvent).detail)
    window.addEventListener('db-assistant-settings', onChange)
    window.addEventListener('db-wake-pause', onPause)
    return () => { window.removeEventListener('db-assistant-settings', onChange); window.removeEventListener('db-wake-pause', onPause) }
  }, [load])

  // Paused while the panel is open: the panel uses the mic itself, and two
  // speech recognisers on one page cancel each other in a loop.
  const wake = useWakeWord(!!config?.wakeWord, config?.wakePhrases || [], open || busyVoice || externalPause, () => {
    setOpen(true)
    setWakeKey((k) => k + 1)
  })

  if (!config) return null
  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Talk to DB"
          title={wake.failed || (wake.active ? 'Say “Hey DB”, or tap' : 'Talk to DB')}
          className="fixed bottom-5 right-5 z-40 rounded-full shadow-lg ring-2 ring-background transition-transform hover:scale-105"
        >
          <DbAvatar size={56} />
          {wake.active && <span className="absolute right-0.5 top-0.5 h-3 w-3 rounded-full bg-success ring-2 ring-background" />}
          {wake.failed && <span className="absolute right-0.5 top-0.5 h-3 w-3 rounded-full bg-warning ring-2 ring-background" />}
        </button>
      )}
      {open && (
        <aside className="fixed inset-0 z-50 flex flex-col bg-background md:relative md:inset-auto md:z-auto md:h-dvh md:w-[380px] md:shrink-0 md:border-l xl:w-[420px]">
          <AssistantConversation config={config} wakeKey={wakeKey} onVoiceBusy={setBusyVoice} onClose={() => setOpen(false)} />
        </aside>
      )}
    </>
  )
}

function AssistantConversation({ config, wakeKey, onVoiceBusy, onClose }: {
  config: PanelConfig; wakeKey: number; onVoiceBusy: (b: boolean) => void; onClose: () => void
}) {
  const [threadId, setThreadId] = useState<string | null>(null)
  const [entries, setEntries] = useState<Entry[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [setup, setSetup] = useState<{ ready: boolean; reason?: string } | null>(null)
  const [voiceOn, setVoiceOn] = useState(config.speakReplies)
  const [convo, setConvo] = useState(false)
  const [rested, setRested] = useState(false)
  const [dropped, setDropped] = useState<Dropped | null>(null)
  const convoRef = useRef(false)
  const lastHeard = useRef(0)
  const errors = useRef(0)
  const endAfterReply = useRef(false)
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const voiceRef = useRef<ReturnType<typeof useVoice> | null>(null)

  const endConvo = useCallback((rest = false) => {
    convoRef.current = false
    setConvo(false)
    setRested(rest)
    if (retryTimer.current) { clearTimeout(retryTimer.current); retryTimer.current = null }
    voiceRef.current?.cancel()
  }, [])

  const listenAgain = useCallback((delay = 250) => {
    if (retryTimer.current) clearTimeout(retryTimer.current)
    retryTimer.current = setTimeout(() => { retryTimer.current = null; if (convoRef.current) voiceRef.current?.start() }, delay)
  }, [])

  const send = useCallback(async (text: string, spokenLanguage: string | null = null) => {
    if (!text.trim() || busy) return
    setError(null)
    setBusy(true)
    setDraft('')
    setEntries((prev) => [...prev, { role: 'owner', text }, { role: 'db', text: '', cards: [] }])
    let reply = ''
    try {
      const res = await apiFetch('/api/assistant/turn', {
        method: 'POST',
        body: JSON.stringify({ text, thread_id: threadId, spoken_language: spokenLanguage }),
        timeoutMs: 120_000,
      })
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'DB could not answer right now.')
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        let idx
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const line = buf.slice(0, idx).replace(/^data: /, '')
          buf = buf.slice(idx + 2)
          if (!line) continue
          const e = JSON.parse(line)
          if (e.type === 'thread') { setThreadId(e.id); writeStore(THREAD_KEY, e.id) }
          else if (e.type === 'text') {
            reply += e.delta
            setStatus(null)
            setEntries((prev) => updateLastDb(prev, (d) => ({ ...d, text: d.text + e.delta })))
          } else if (e.type === 'status') setStatus(STATUS_WORDS[e.tool] || 'Ek second…')
          else if (e.type === 'card') setEntries((prev) => updateLastDb(prev, (d) => ({ ...d, cards: [...(d.cards || []), e.card] })))
          else if (e.type === 'error') setError(e.message)
        }
      }
    } catch (err) {
      setError((err as Error).message)
      endConvo()
    } finally {
      setBusy(false)
      setStatus(null)
    }
    const v = voiceRef.current
    if (v && voiceOn && reply.trim()) await v.speak(reply)
    if (endAfterReply.current) { endAfterReply.current = false; endConvo(true); return }
    if (convoRef.current) { lastHeard.current = Date.now(); listenAgain(200) }
  }, [busy, threadId, voiceOn, endConvo, listenAgain])

  const onHeard = useCallback((text: string, lang: string | null) => {
    setDropped(null)
    lastHeard.current = Date.now()
    errors.current = 0
    if (convoRef.current && END_RE.test(text.trim())) endAfterReply.current = true
    send(text, lang)
  }, [send])

  // Nothing usable heard. In a conversation, keep listening until the quiet
  // window runs out; repeated mic errors end it (never a tight retry loop).
  const onNothing = useCallback((why: NothingReason, d?: Dropped) => {
    if (d && d.reason !== 'filler') setDropped(d)
    if (!convoRef.current) return
    if (why === 'error') {
      errors.current++
      if (errors.current >= 2) { endConvo(true); return }
      listenAgain(1200)
      return
    }
    if (Date.now() - lastHeard.current < config.idleSeconds * 1000) listenAgain(250)
    else endConvo(true)
  }, [config.idleSeconds, endConvo, listenAgain])

  const voice = useVoice({ listen: config.listen, speak: config.speak, speakReplies: voiceOn, gate: config.gate }, onHeard, onNothing)
  voiceRef.current = voice

  useEffect(() => { onVoiceBusy(voice.listening || voice.speaking || voice.transcribing || busy) }, [voice.listening, voice.speaking, voice.transcribing, busy, onVoiceBusy])
  useEffect(() => () => { onVoiceBusy(false); if (retryTimer.current) clearTimeout(retryTimer.current) }, [onVoiceBusy])

  const startConvo = useCallback(() => {
    convoRef.current = true
    setConvo(true)
    setRested(false)
    errors.current = 0
    lastHeard.current = Date.now()
    voiceRef.current?.start()
  }, [])

  // Woken by "Hey DB": start a conversation once the wake listener has
  // released the mic (it is stopping as the panel opens).
  useEffect(() => {
    if (wakeKey === 0) return
    const t = setTimeout(startConvo, 500)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wakeKey])

  useEffect(() => {
    apiFetch('/api/assistant/setup').then((r) => r.json()).then(setSetup).catch(() => setSetup(null))
    const saved = readStore(THREAD_KEY)
    if (saved) {
      apiFetch(`/api/assistant/threads?id=${saved}`).then(async (r) => {
        if (!r.ok) { writeStore(THREAD_KEY, null); return }
        const j = await r.json()
        setThreadId(j.id)
        const list: Entry[] = j.transcript
        if (j.pending && list.length) list[list.length - 1] = { ...list[list.length - 1], cards: [{ type: 'confirm', action_id: j.pending.action_id, title: 'Waiting for your OK', summary: j.pending.summary, warnings: j.pending.warnings || [] }] }
        setEntries(list)
      }).catch(() => {})
    }
  }, [])

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }) }, [entries, status, voice.interim])

  const wakeDb = async () => {
    const r = await apiFetch('/api/assistant/setup', { method: 'POST' })
    const j = await r.json()
    if (!r.ok) setError(j.error || 'Could not set up DB.')
    setSetup(j)
  }

  const newConversation = () => { writeStore(THREAD_KEY, null); setThreadId(null); setEntries([]); setError(null) }
  const toggleVoice = () => { const next = !voiceOn; setVoiceOn(next); if (!next) voice.stopSpeaking() }
  const micTap = () => {
    if (voice.listening) { voice.stop(); return } // done talking: send now
    if (voice.speaking) { voice.stopSpeaking(); if (convoRef.current) listenAgain(150); return } // interrupt her
    if (config.continuous) startConvo()
    else voice.start()
  }

  const ready = !!setup?.ready
  const avatarState: AvatarState = voice.speaking ? 'speaking' : voice.listening ? 'listening' : (busy || voice.transcribing) ? 'thinking' : 'idle'
  const statusLine = voice.speaking ? 'Speaking…' : voice.listening ? 'Listening…' : voice.transcribing ? 'Samajh rahi hoon…' : busy ? (status || 'Soch rahi hoon…') : convo ? 'Conversation on' : 'Online'

  return (
    <div className="flex h-full flex-col bg-gradient-to-b from-primary/5 via-background to-background">
      <header className="flex items-center gap-3 border-b bg-background/80 px-4 py-3 backdrop-blur">
        <DbAvatar state={avatarState} size={44} levelRef={voice.levelRef} />
        <div className="min-w-0 flex-1">
          <p className="font-semibold leading-tight">DB</p>
          <p className={cn('truncate text-xs', voice.listening ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground')}>{statusLine}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={toggleVoice} aria-label={voiceOn ? 'Mute DB' : 'Unmute DB'}>
          {voiceOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
        </Button>
        <Button variant="ghost" size="sm" onClick={newConversation} aria-label="New conversation"><Plus className="h-4 w-4" /></Button>
        <Button variant="ghost" size="sm" onClick={() => { endConvo(); onClose() }} aria-label="Close DB"><X className="h-4 w-4" /></Button>
      </header>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {setup && !setup.ready && (
          <div className="rounded-xl border bg-muted p-3 text-sm">
            {setup.reason === 'deactivated'
              ? <>DB is deactivated. Turn her back on in <Link href="/dashboard/settings" className="underline">Settings → Users</Link>.</>
              : <>
                  {setup.reason === 'logged_off' ? 'DB is logged off.' : 'DB is not set up yet. This creates her own ERP user, "DB", so you can see what she did.'}
                  <Button size="sm" className="mt-2 w-full" onClick={wakeDb}>{setup.reason === 'logged_off' ? 'Wake DB up' : 'Set up DB'}</Button>
                </>}
          </div>
        )}

        {entries.length === 0 && ready && (
          <div className="flex flex-col items-center pt-6 text-center">
            <DbAvatar state={avatarState} size={112} levelRef={voice.levelRef} />
            <p className="mt-4 text-lg font-semibold">Hi Shishir!</p>
            <p className="mt-1 max-w-[18rem] text-sm text-muted-foreground">Tap the mic and just talk, I’ll keep listening till you’re done. Or type below.</p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" onClick={() => send(s)} disabled={busy}
                  className="rounded-full border bg-background px-3 py-1.5 text-xs hover:bg-muted">{s}</button>
              ))}
            </div>
          </div>
        )}

        {entries.map((e, i) => (
          e.role === 'owner' ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-tr-sm bg-primary px-3 py-2 text-sm text-primary-foreground shadow-sm">{e.text}</div>
            </div>
          ) : (
            <div key={i} className="flex items-start gap-2">
              <DbAvatar size={28} className="mt-0.5" />
              <div className="flex min-w-0 max-w-[85%] flex-col gap-2">
                {e.text
                  ? <div className="whitespace-pre-wrap rounded-2xl rounded-tl-sm border bg-background px-3 py-2 text-sm shadow-sm">{e.text}</div>
                  : busy && i === entries.length - 1 && <TypingDots label={status} />}
                {e.cards?.map((c, j) => <AssistantCardView key={j} card={c} disabled={busy} onAnswer={send} />)}
              </div>
            </div>
          )
        ))}

        {voice.interim && <div className="flex justify-end"><p className="max-w-[85%] rounded-2xl rounded-tr-sm border border-dashed px-3 py-2 text-sm italic text-muted-foreground">{voice.interim}</p></div>}
        {dropped && !voice.interim && (
          <div className="flex justify-end">
            <div className="max-w-[85%] rounded-2xl rounded-tr-sm border border-dashed px-3 py-2 text-sm text-muted-foreground">
              <p className="italic">“{dropped.text}”</p>
              <p className="mt-1 text-xs">
                {dropped.reason === 'too_quiet' ? 'Ignored: sounded far away (Settings → Ignore far-away voices).' : 'Ignored: I wasn’t sure I heard that right.'}{' '}
                <button type="button" className="font-medium text-foreground underline" onClick={() => { const t = dropped.text; setDropped(null); lastHeard.current = Date.now(); send(t) }}>That was me, send it</button>
              </p>
            </div>
          </div>
        )}
        {voice.micError && <p className="rounded-xl bg-destructive/10 p-2 text-sm text-destructive">{voice.micError}</p>}
        {error && <p className="rounded-xl bg-destructive/10 p-2 text-sm text-destructive">{error}</p>}
      </div>

      <div className="border-t bg-background/90 p-3 backdrop-blur">
        {convo && (
          <div className="mb-2 flex items-center justify-between gap-2 rounded-full bg-emerald-500/10 px-3 py-1 text-xs text-emerald-700 dark:text-emerald-300">
            <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />Conversation on: I stop after {config.idleSeconds}s of quiet</span>
            <button type="button" onClick={() => endConvo()} className="font-medium underline">End</button>
          </div>
        )}
        {rested && !convo && <p className="mb-2 text-center text-xs text-muted-foreground">Paused. Tap the mic or say “Hey DB” when you need me.</p>}
        <div className="flex items-center gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send(draft)}
            placeholder={voice.supported ? 'Type, or tap the mic…' : 'Type to DB…'}
            disabled={busy || !ready}
            className="h-11 min-w-0 flex-1 rounded-full border bg-background px-4 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          />
          {draft.trim() ? (
            <Button className="h-11 w-11 shrink-0 rounded-full p-0" onClick={() => send(draft)} disabled={busy || !ready} aria-label="Send"><Send className="h-4 w-4" /></Button>
          ) : voice.supported && (
            <button
              type="button"
              disabled={busy || voice.transcribing || !ready}
              onClick={micTap}
              aria-label={voice.listening ? 'Done talking' : voice.speaking ? 'Interrupt DB' : 'Talk to DB'}
              className={cn('relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-white shadow-md transition disabled:opacity-50',
                voice.listening ? 'bg-emerald-500' : 'bg-gradient-to-br from-indigo-500 to-pink-500 hover:scale-105')}
            >
              {voice.listening && <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400/40" />}
              {voice.listening ? <Square className="relative h-4 w-4" /> : <Mic className="relative h-5 w-5" />}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function TypingDots({ label }: { label: string | null }) {
  return (
    <div className="flex items-center gap-2 rounded-2xl rounded-tl-sm border bg-background px-3 py-2 text-xs text-muted-foreground shadow-sm">
      <span className="flex gap-1">
        {[0, 150, 300].map((d) => <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60" style={{ animationDelay: `${d}ms` }} />)}
      </span>
      {label}
    </div>
  )
}

function updateLastDb(prev: Entry[], fn: (e: Entry) => Entry): Entry[] {
  const copy = [...prev]
  for (let i = copy.length - 1; i >= 0; i--) if (copy[i].role === 'db') { copy[i] = fn(copy[i]); break }
  return copy
}

function AssistantCardView({ card, disabled, onAnswer }: { card: Card; disabled: boolean; onAnswer: (t: string) => void }) {
  if (card.type === 'confirm') {
    return (
      <div className="w-full rounded-xl border bg-background p-3 text-sm shadow-sm">
        <p className="font-medium">{card.title}</p>
        <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{card.summary}</p>
        {card.warnings.length > 0 && (
          <ul className="mt-2 space-y-1 text-xs text-warning">
            {card.warnings.map((w, i) => <li key={i}>⚠ {w}</li>)}
          </ul>
        )}
        <div className="mt-3 flex gap-2">
          <Button size="sm" disabled={disabled} onClick={() => onAnswer('Haan, confirm kar do.')}>Confirm</Button>
          <Button size="sm" variant="outline" disabled={disabled} onClick={() => onAnswer('Nahi, abhi cancel karo.')}>Cancel</Button>
        </div>
      </div>
    )
  }
  if (card.type === 'done') {
    return (
      <div className="w-full rounded-xl border border-success/30 bg-success/10 p-3 text-sm">
        <p className="font-medium">✓ {card.title}</p>
        <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{card.detail}</p>
      </div>
    )
  }
  return (
    <div className="w-full rounded-xl border bg-background p-3 text-sm shadow-sm">
      <p className="font-medium">{card.title}</p>
      <div className="mt-2 flex flex-col gap-2">
        {card.whatsapp_to_customer && (
          <a href={card.whatsapp_to_customer} target="_blank" rel="noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-3 py-1.5 text-primary-foreground">
            <MessageCircle className="h-4 w-4" />Send to customer on WhatsApp
          </a>
        )}
        <a href={card.whatsapp_pick_chat} target="_blank" rel="noreferrer"
          className="inline-flex items-center justify-center gap-2 rounded-md border px-3 py-1.5">
          <MessageCircle className="h-4 w-4" />Send to me / pick a chat
        </a>
        <a href={card.pdf_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs underline">
          View PDF <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </div>
  )
}
