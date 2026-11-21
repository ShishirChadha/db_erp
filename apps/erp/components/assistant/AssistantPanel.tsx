'use client'

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import { Mic, Square, Send, Volume2, VolumeX, Plus, X, ExternalLink, MessageCircle, Minus, Keyboard, Captions, CaptionsOff, Copy, Check, RotateCcw, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { apiFetch } from '@/lib/api-client'
import { cn } from '@/lib/utils'
import { useVoice, useWakeWord, useStopWords, chime, buzz, type SpeakProvider, type VoiceGate, type NothingReason, type Dropped } from './useVoice'
import { DbAvatar, type AvatarState } from './DbAvatar'
import { LAUNCHER_SIZE, PANEL_WIDTH, TEXT_SIZE, THEMES, cleanAppearance, type Appearance } from './appearance'

// DB, the owner's voice secretary. Her face floats on every dashboard page.
//
// Where the panel sits (by screen width, see appearance.ts):
//   < 600 px  (phones, Galaxy Z Fold cover screen): full screen, sized to the
//             visible area so the keyboard never covers the input;
//   600-1279  (Fold opened, tablets, split windows): beside the ERP (split) or
//             floating over it -- owner's choice;
//   >= 1280   (laptop): docked beside the ERP.
// Folding/unfolding just re-lays it out; the conversation is never interrupted.
//
// Two ways a voice conversation looks (industry patterns): "chat" -- the live
// transcript, like ChatGPT Voice inside a chat; "stage" -- a big avatar with
// captions and large controls, like Gemini Live. Auto = stage on phones and the
// Fold, chat on a laptop. Minimise keeps the conversation running in a floating
// bubble while you use the ERP.
//
// Conversation mode: tap the mic once (or say "Hey DB") and talk normally --
// after each reply she listens again by herself, until you go quiet, say
// "bas"/"bye"/"thanks", tap End, or close the panel.

type Card =
  | { type: 'confirm'; action_id: string; title: string; summary: string; warnings: string[] }
  | { type: 'done'; title: string; detail: string; link?: string | null }
  | { type: 'share'; title: string; pdf_url: string; whatsapp_to_customer: string | null; whatsapp_pick_chat: string }

type Entry = { role: 'owner' | 'db'; text: string; cards?: Card[]; at?: number }

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
const timeOf = (ms?: number) => (ms ? new Date(ms).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : '')

function useMedia(query: string) {
  const [match, setMatch] = useState(false)
  useEffect(() => {
    const m = window.matchMedia(query)
    const on = () => setMatch(m.matches)
    on()
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [query])
  return match
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
  wakeReply: string
  look: Appearance
}

type VoiceState = { busy: boolean; avatar: AvatarState; convo: boolean }

// Shown only to DB's master: /api/assistant/config answers 403 for anyone
// else (other owners included), and then nothing renders at all.
export function AssistantLauncher() {
  const [config, setConfig] = useState<PanelConfig | null>(null)
  const [open, setOpen] = useState(false)
  const [minimized, setMinimized] = useState(false)
  const [wakeKey, setWakeKey] = useState(0)
  const [vs, setVs] = useState<VoiceState>({ busy: false, avatar: 'idle', convo: false })
  const [externalPause, setExternalPause] = useState(false)
  const [vv, setVv] = useState<{ h: number; top: number } | null>(null)

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
        wakeReply: typeof s.wake_reply === 'string' ? s.wake_reply : 'Yes Boss?',
        look: cleanAppearance(s.appearance),
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

  // Full-screen mode on phones follows the *visible* area, so the on-screen
  // keyboard (Android Chrome overlays it by default) never hides the input.
  useEffect(() => {
    const view = window.visualViewport
    if (!view) return
    const on = () => setVv(window.innerWidth < 600 ? { h: view.height, top: view.offsetTop } : null)
    on()
    view.addEventListener('resize', on)
    view.addEventListener('scroll', on)
    return () => { view.removeEventListener('resize', on); view.removeEventListener('scroll', on) }
  }, [])

  // Listens whenever DB is idle -- panel open, minimised or closed. Paused while
  // she listens, thinks, speaks or a conversation is running; useVoice also
  // hands the mic over explicitly so two recognisers never run at once.
  const wake = useWakeWord(!!config?.wakeWord, config?.wakePhrases || [], vs.busy || externalPause, () => {
    if (config?.look.haptics) buzz([20, 40, 20])
    if (config?.look.sounds) chime('wake')
    setOpen(true)
    setMinimized(false)
    setWakeKey((k) => k + 1)
  })

  if (!config) return null
  const a = config.look
  const theme = THEMES[a.theme]
  const showLauncher = !open || minimized
  const launcherSize = LAUNCHER_SIZE[a.launcher_size]
  const glowing = a.edge_glow && (vs.avatar === 'listening' || vs.avatar === 'speaking')
  const glowColor = vs.avatar === 'speaking' ? theme.glowSpeak : theme.glowListen

  const asideStyle = {
    '--db-w': `${PANEL_WIDTH[a.panel_width]}px`,
    ...(vv ? { height: vv.h, top: vv.top } : {}),
  } as CSSProperties
  const right = a.panel_side === 'right'
  const asideClass = cn(
    'z-50 flex-col overflow-hidden bg-background',
    minimized ? 'hidden' : 'flex',
    // phones / Fold cover screen: full screen
    'fixed inset-x-0 top-0 h-dvh',
    a.wide_layout === 'split'
      // Fold opened / tablets / laptops: beside the ERP; the page narrows.
      ? cn('min-[600px]:static min-[600px]:z-auto min-[600px]:h-dvh min-[600px]:w-[min(var(--db-w),46vw)] min-[600px]:shrink-0 min-[600px]:pt-14 md:pt-0',
          right ? 'min-[600px]:order-2 min-[600px]:border-l' : 'min-[600px]:border-r')
      // floating over the ERP up to 1279 px, docked from 1280 px
      : cn('min-[600px]:bottom-3 min-[600px]:top-16 min-[600px]:h-auto min-[600px]:w-[min(var(--db-w),calc(100vw-24px))] min-[600px]:rounded-2xl min-[600px]:border min-[600px]:shadow-2xl md:top-3',
          right ? 'min-[600px]:left-auto min-[600px]:right-3' : 'min-[600px]:left-3 min-[600px]:right-auto',
          'xl:static xl:z-auto xl:h-dvh xl:w-[var(--db-w)] xl:shrink-0 xl:rounded-none xl:border-y-0 xl:shadow-none',
          right ? 'xl:order-2 xl:border-l xl:border-r-0' : 'xl:border-l-0 xl:border-r'),
  )

  return (
    <>
      <style>{`@keyframes db-edge { 0%, 100% { opacity: .55 } 50% { opacity: 1 } }`}</style>
      {glowing && (
        <div aria-hidden className="pointer-events-none fixed inset-0 z-[60] rounded-[inherit]"
          style={{ boxShadow: `inset 0 0 28px 4px ${glowColor}aa, inset 0 0 80px 6px ${glowColor}44`, animation: a.motion === 'full' ? 'db-edge 1.6s ease-in-out infinite' : undefined }} />
      )}
      {showLauncher && (
        <button
          type="button"
          onClick={() => { setOpen(true); setMinimized(false) }}
          aria-label={minimized ? 'Open DB (conversation running)' : 'Talk to DB'}
          title={wake.failed || (wake.active ? 'Say “Hey DB”, or tap' : 'Talk to DB')}
          className={cn('fixed z-40 rounded-full shadow-lg ring-2 ring-background transition-transform hover:scale-105', a.launcher_side === 'right' ? 'right-4' : 'left-4')}
          style={{ bottom: 'max(1.25rem, calc(env(safe-area-inset-bottom) + 0.75rem))' }}
        >
          <DbAvatar size={launcherSize} state={minimized ? vs.avatar : 'idle'} look={a} />
          {minimized && vs.convo && <span className="absolute -top-1 left-1/2 -translate-x-1/2 rounded-full bg-emerald-500 px-1.5 text-[10px] font-semibold text-white">LIVE</span>}
          {!minimized && wake.active && <span className="absolute right-0.5 top-0.5 h-3 w-3 rounded-full bg-success ring-2 ring-background" />}
          {wake.failed && <span className="absolute right-0.5 top-0.5 h-3 w-3 rounded-full bg-warning ring-2 ring-background" />}
        </button>
      )}
      {open && (
        <aside className={asideClass} style={asideStyle} aria-label="DB assistant">
          <AssistantConversation
            config={config}
            wakeKey={wakeKey}
            wakeActive={wake.active}
            onState={setVs}
            onMinimize={() => setMinimized(true)}
            onClose={() => { setOpen(false); setMinimized(false); setWakeKey(0); setVs({ busy: false, avatar: 'idle', convo: false }) }}
          />
        </aside>
      )}
    </>
  )
}

function AssistantConversation({ config, wakeKey, wakeActive, onState, onMinimize, onClose }: {
  config: PanelConfig; wakeKey: number; wakeActive: boolean
  onState: (s: VoiceState) => void; onMinimize: () => void; onClose: () => void
}) {
  const a = config.look
  const theme = THEMES[a.theme]
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
  const [saying, setSaying] = useState('') // the reply she is reading aloud now
  const [captions, setCaptions] = useState(a.captions)
  const [chatOverride, setChatOverride] = useState(false) // "keyboard" pressed on the stage
  const interrupted = useRef(false)
  const convoRef = useRef(false)
  const lastHeard = useRef(0)
  const errors = useRef(0)
  const endAfterReply = useRef(false)
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const voiceRef = useRef<ReturnType<typeof useVoice> | null>(null)
  const compact = useMedia('(max-width: 1023px)') // phones, Fold opened, tablets

  const endConvo = useCallback((rest = false) => {
    convoRef.current = false
    setConvo(false)
    setRested(rest)
    setChatOverride(false)
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
    const now = Date.now()
    setEntries((prev) => [...prev, { role: 'owner', text, at: now }, { role: 'db', text: '', cards: [], at: now }])
    let reply = ''
    const wasInterrupted = interrupted.current
    interrupted.current = false
    try {
      const res = await apiFetch('/api/assistant/turn', {
        method: 'POST',
        body: JSON.stringify({ text, thread_id: threadId, spoken_language: spokenLanguage, interrupted: wasInterrupted }),
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
    if (v && voiceOn && reply.trim()) { setSaying(reply); await v.speak(reply); setSaying('') }
    if (endAfterReply.current) { endAfterReply.current = false; endConvo(true); return }
    if (convoRef.current) { lastHeard.current = Date.now(); listenAgain(200) }
  }, [busy, threadId, voiceOn, endConvo, listenAgain])

  const onHeard = useCallback((text: string, lang: string | null) => {
    setDropped(null)
    lastHeard.current = Date.now()
    errors.current = 0
    if (a.sounds) chime('heard')
    if (convoRef.current && END_RE.test(text.trim())) endAfterReply.current = true
    send(text, lang)
  }, [send, a.sounds])

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

  const avatarState: AvatarState = voice.speaking ? 'speaking' : voice.listening ? 'listening' : (busy || voice.transcribing) ? 'thinking' : 'idle'
  useEffect(() => {
    onState({ busy: convo || voice.listening || voice.speaking || voice.transcribing || busy, avatar: avatarState, convo })
  }, [convo, voice.listening, voice.speaking, voice.transcribing, busy, avatarState, onState])
  useEffect(() => () => { if (retryTimer.current) clearTimeout(retryTimer.current) }, [])

  // A tiny buzz and chime the moment she starts listening, so you know without looking.
  const wasListening = useRef(false)
  useEffect(() => {
    if (voice.listening && !wasListening.current) {
      if (a.haptics) buzz(25)
      if (a.sounds) chime('listen')
    }
    wasListening.current = voice.listening
  }, [voice.listening, a.haptics, a.sounds])

  // "Stop" / "bas" / "pata hai" while she talks: she stops at once. In a
  // conversation, listening resumes by itself (send() continues after speak()).
  const interrupt = useCallback(() => {
    if (!voiceRef.current?.speaking) return
    interrupted.current = true
    voiceRef.current.stopSpeaking()
  }, [])
  useStopWords(voice.speaking, saying, interrupt)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (voiceRef.current?.speaking) interrupt()
      else if (voiceRef.current?.listening) endConvo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [interrupt, endConvo])

  const startConvo = useCallback(() => {
    convoRef.current = true
    setConvo(true)
    setRested(false)
    errors.current = 0
    lastHeard.current = Date.now()
    voiceRef.current?.start()
  }, [])

  // Woken by "Hey DB": answer "Yes Boss?" (cached audio after the first time,
  // so it is instant and free) and start a conversation.
  useEffect(() => {
    if (wakeKey === 0) return
    let cancelled = false
    convoRef.current = true
    setConvo(true)
    setRested(false)
    const t = setTimeout(async () => {
      if (voiceOn && config.wakeReply.trim()) await voiceRef.current?.speak(config.wakeReply, undefined, true)
      if (!cancelled && convoRef.current) startConvo()
    }, 300)
    return () => { cancelled = true; clearTimeout(t) }
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

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: a.motion === 'full' ? 'smooth' : 'auto' }) }, [entries, status, voice.interim, a.motion])

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
    if (voice.speaking) { interrupt(); return } // interrupt her; a conversation resumes listening by itself
    if (config.continuous) startConvo()
    else voice.start()
  }
  const close = () => { endConvo(); voice.stopSpeaking(); onClose() }

  const ready = !!setup?.ready
  const talking = convo || voice.listening || voice.speaking || voice.transcribing || (busy && convo)
  const stageView = a.voice_view === 'stage' || (a.voice_view === 'auto' && compact)
  const onStage = stageView && talking && !chatOverride
  const statusLine = voice.speaking ? 'Speaking… say “stop” to cut me off' : voice.listening ? 'Listening…' : voice.transcribing ? 'Samajh rahi hoon…' : busy ? (status || 'Soch rahi hoon…') : convo ? 'Conversation on' : wakeActive ? 'Say “Hey DB” or tap the mic' : 'Online'
  const lastDb = [...entries].reverse().find((e) => e.role === 'db')
  const pendingCard = lastDb?.cards?.find((c) => c.type === 'confirm' || c.type === 'share')

  const sendDropped = () => { if (!dropped) return; const t = dropped.text; setDropped(null); lastHeard.current = Date.now(); send(t) }

  return (
    <div className="relative flex h-full flex-col" style={{ background: `linear-gradient(to bottom, ${theme.from}12, transparent 30%)` }}>
      <p className="sr-only" aria-live="polite">{statusLine}</p>

      {onStage ? (
        <VoiceStage
          look={a}
          state={avatarState}
          levelRef={voice.levelRef}
          status={statusLine}
          saying={saying || (busy ? '' : lastDb?.text || '')}
          interim={voice.interim}
          captions={captions}
          onToggleCaptions={() => setCaptions((c) => !c)}
          dropped={dropped}
          onSendDropped={sendDropped}
          error={error || voice.micError}
          card={pendingCard ? <AssistantCardView card={pendingCard} disabled={busy} onAnswer={send} theme={theme} /> : null}
          listening={voice.listening}
          speaking={voice.speaking}
          busy={busy || voice.transcribing}
          onMic={micTap}
          onKeyboard={() => setChatOverride(true)}
          onEnd={() => { endConvo(); voice.stopSpeaking() }}
          onMinimize={onMinimize}
          compact={compact}
        />
      ) : (
        <>
          <header className="flex items-center gap-3 border-b bg-background/80 px-3 py-2.5 backdrop-blur sm:px-4">
            <DbAvatar state={avatarState} size={44} levelRef={voice.levelRef} look={a} />
            <div className="min-w-0 flex-1">
              <p className="font-semibold leading-tight">DB</p>
              <p className="truncate text-xs" style={{ color: voice.listening ? theme.glowListen : undefined }}>
                <span className={voice.listening ? '' : 'text-muted-foreground'}>{statusLine}</span>
              </p>
            </div>
            <IconBtn onClick={toggleVoice} label={voiceOn ? 'Mute DB' : 'Unmute DB'}>{voiceOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}</IconBtn>
            <IconBtn onClick={newConversation} label="New conversation"><Plus className="h-4 w-4" /></IconBtn>
            <IconBtn onClick={onMinimize} label="Minimise (keeps the conversation going)"><Minus className="h-4 w-4" /></IconBtn>
            <IconBtn onClick={close} label="Close DB"><X className="h-4 w-4" /></IconBtn>
          </header>

          <div ref={scrollRef} className={cn('flex-1 space-y-3 overflow-y-auto overscroll-contain px-3 py-4 sm:px-4', TEXT_SIZE[a.text_size])}>
            {setup && !setup.ready && (
              <div className="rounded-xl border bg-muted p-3">
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
                <DbAvatar state={avatarState} size={compact ? 128 : 112} levelRef={voice.levelRef} look={a} />
                <p className="mt-4 text-lg font-semibold">Hi Boss!</p>
                <p className="mt-1 max-w-[18rem] text-sm text-muted-foreground">Tap the mic and just talk, I’ll keep listening till you’re done. Or type below.</p>
                <div className="mt-5 flex flex-wrap justify-center gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} type="button" onClick={() => send(s)} disabled={busy}
                      className="min-h-9 rounded-full border bg-background px-3 py-1.5 text-xs hover:bg-muted">{s}</button>
                  ))}
                </div>
              </div>
            )}

            {entries.map((e, i) => (
              <MessageRow key={i} entry={e} look={a} last={i === entries.length - 1} busy={busy} status={status}
                onAnswer={send} onReplay={(t) => voice.speak(t, undefined, false)} canReplay={voiceOn} />
            ))}

            {voice.interim && <div className="flex justify-end"><p className="max-w-[85%] rounded-2xl rounded-tr-sm border border-dashed px-3 py-2 italic text-muted-foreground">{voice.interim}</p></div>}
            {dropped && !voice.interim && <DroppedNote dropped={dropped} onSend={sendDropped} />}
            {voice.micError && <p className="rounded-xl bg-destructive/10 p-2 text-destructive">{voice.micError}</p>}
            {error && <p className="rounded-xl bg-destructive/10 p-2 text-destructive">{error}</p>}
          </div>

          <div className="border-t bg-background/90 p-3 backdrop-blur" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
            {convo && (
              <div className="mb-2 flex items-center justify-between gap-2 rounded-full px-3 py-1 text-xs" style={{ background: `${theme.glowListen}22` }}>
                <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: theme.glowListen }} />Conversation on: I stop after {config.idleSeconds}s of quiet</span>
                <span className="flex items-center gap-3">
                  {stageView && <button type="button" onClick={() => setChatOverride(false)} className="font-medium underline">Voice view</button>}
                  <button type="button" onClick={() => endConvo()} className="font-medium underline">End</button>
                </span>
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
                enterKeyHint="send"
                className="h-12 min-w-0 flex-1 rounded-full border bg-background px-4 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 sm:h-11 sm:text-sm"
              />
              {draft.trim() ? (
                <button type="button" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-white shadow-md disabled:opacity-50"
                  style={{ background: `linear-gradient(135deg, ${theme.from}, ${theme.to})` }} onClick={() => send(draft)} disabled={busy || !ready} aria-label="Send">
                  <Send className="h-4 w-4" />
                </button>
              ) : voice.supported && (
                <MicButton size={52} theme={theme} listening={voice.listening} speaking={voice.speaking} disabled={busy || voice.transcribing || !ready} onClick={micTap} />
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ voice stage

export function VoiceStage(p: {
  look: Appearance; state: AvatarState; levelRef: { current: number }; status: string; saying: string; interim: string
  captions: boolean; onToggleCaptions: () => void; dropped: Dropped | null; onSendDropped: () => void; error: string | null
  card: React.ReactNode; listening: boolean; speaking: boolean; busy: boolean
  onMic: () => void; onKeyboard: () => void; onEnd: () => void; onMinimize: () => void; compact: boolean
}) {
  const theme = THEMES[p.look.theme]
  const glow = p.state === 'speaking' ? theme.glowSpeak : p.state === 'listening' ? theme.glowListen : theme.from
  return (
    <div className="relative flex h-full flex-col overflow-hidden text-white"
      style={{ background: `radial-gradient(110% 70% at 50% 32%, ${glow}40, transparent 62%), radial-gradient(120% 60% at 50% 105%, ${theme.to}55, transparent 70%), #0b1020`, transition: 'background 0.6s ease' }}>
      <div className="flex items-center justify-between px-3 pt-3" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}>
        <StageBtn onClick={p.onMinimize} label="Minimise (keeps talking)"><ChevronDown className="h-5 w-5" /></StageBtn>
        <span className="text-sm font-medium text-white/80">DB</span>
        <StageBtn onClick={p.onToggleCaptions} label={p.captions ? 'Hide captions' : 'Show captions'}>
          {p.captions ? <Captions className="h-5 w-5" /> : <CaptionsOff className="h-5 w-5" />}
        </StageBtn>
      </div>

      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5 px-6">
        <DbAvatar state={p.state} size={p.compact ? 220 : 184} levelRef={p.levelRef} look={p.look} />
        <p className="text-center text-base font-medium text-white/90">{p.status}</p>
        {p.captions && (p.saying || p.interim) && (
          <div className="max-h-[30vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white/10 px-4 py-3 text-center leading-relaxed backdrop-blur-md">
            {p.interim ? <p className="italic text-white/70">“{p.interim}”</p> : <p className="text-[15px] text-white">{p.saying}</p>}
          </div>
        )}
        {p.dropped && !p.interim && (
          <button type="button" onClick={p.onSendDropped} className="rounded-full bg-white/10 px-4 py-2 text-xs text-white/80">
            Didn’t send “{p.dropped.text.slice(0, 40)}” · <b className="text-white">That was me, send it</b>
          </button>
        )}
        {p.card && <div className="w-full max-w-md text-foreground">{p.card}</div>}
        {p.error && <p className="max-w-md rounded-xl bg-red-500/20 px-3 py-2 text-center text-sm">{p.error}</p>}
      </div>

      <div className="flex items-center justify-center gap-8 px-6 pt-4" style={{ paddingBottom: 'max(1.5rem, calc(env(safe-area-inset-bottom) + 1rem))' }}>
        <StageBtn onClick={p.onKeyboard} label="Show chat" big><Keyboard className="h-6 w-6" /></StageBtn>
        <MicButton size={76} theme={theme} listening={p.listening} speaking={p.speaking} disabled={p.busy} onClick={p.onMic} />
        <StageBtn onClick={p.onEnd} label="End conversation" big danger><X className="h-6 w-6" /></StageBtn>
      </div>
    </div>
  )
}

function StageBtn({ children, onClick, label, big, danger }: { children: React.ReactNode; onClick: () => void; label: string; big?: boolean; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label}
      className={cn('flex items-center justify-center rounded-full backdrop-blur-md transition active:scale-95', big ? 'h-14 w-14' : 'h-11 w-11',
        danger ? 'bg-red-500/90 text-white hover:bg-red-500' : 'bg-white/12 text-white hover:bg-white/20')}
      style={danger ? undefined : { background: 'rgba(255,255,255,0.12)' }}>
      {children}
    </button>
  )
}

function MicButton({ size, theme, listening, speaking, disabled, onClick }: {
  size: number; theme: typeof THEMES[keyof typeof THEMES]; listening: boolean; speaking: boolean; disabled: boolean; onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={listening ? 'Done talking' : speaking ? 'Interrupt DB' : 'Talk to DB'}
      className="relative flex shrink-0 items-center justify-center rounded-full text-white shadow-lg transition active:scale-95 disabled:opacity-50"
      style={{ width: size, height: size, background: listening ? theme.glowListen : `linear-gradient(135deg, ${theme.from}, ${theme.to})` }}
    >
      {listening && <span className="absolute inset-0 animate-ping rounded-full opacity-40" style={{ background: theme.glowListen }} />}
      {listening || speaking ? <Square className="relative" style={{ width: size * 0.3, height: size * 0.3 }} /> : <Mic className="relative" style={{ width: size * 0.38, height: size * 0.38 }} />}
    </button>
  )
}

function IconBtn({ children, onClick, label }: { children: React.ReactNode; onClick: () => void; label: string }) {
  // 40px targets: comfortable on a phone, still compact on a laptop.
  return <Button variant="ghost" size="sm" className="h-10 w-10 p-0" onClick={onClick} aria-label={label} title={label}>{children}</Button>
}

// ------------------------------------------------------------------ chat rows

export function MessageRow({ entry: e, look, last, busy, status, onAnswer, onReplay, canReplay }: {
  entry: Entry; look: Appearance; last: boolean; busy: boolean; status: string | null
  onAnswer: (t: string) => void; onReplay: (t: string) => void; canReplay: boolean
}) {
  const theme = THEMES[look.theme]
  const [copied, setCopied] = useState(false)
  const minimal = look.bubbles === 'minimal'
  if (e.role === 'owner') {
    return (
      <div className="flex flex-col items-end gap-0.5">
        <div className={cn('max-w-[85%] whitespace-pre-wrap', minimal ? 'text-right text-muted-foreground' : 'rounded-2xl rounded-tr-sm px-3 py-2 text-white shadow-sm')}
          style={minimal ? undefined : { background: `linear-gradient(135deg, ${theme.from}, ${theme.to})` }}>{e.text}</div>
        {look.timestamps && e.at && <span className="text-[10px] text-muted-foreground">{timeOf(e.at)}</span>}
      </div>
    )
  }
  const copy = async () => { try { await navigator.clipboard.writeText(e.text); setCopied(true); setTimeout(() => setCopied(false), 1200) } catch { /* blocked */ } }
  return (
    <div className="group flex items-start gap-2">
      <DbAvatar size={28} className="mt-0.5" look={look} />
      <div className="flex min-w-0 max-w-[85%] flex-col gap-1.5">
        {e.text
          ? <div className={cn('whitespace-pre-wrap', minimal ? '' : 'rounded-2xl rounded-tl-sm border bg-background px-3 py-2 shadow-sm')}>{e.text}</div>
          : busy && last && <TypingDots label={status} />}
        {e.text && (
          <div className="flex items-center gap-1 text-muted-foreground opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100">
            {look.timestamps && e.at && <span className="mr-1 text-[10px]">{timeOf(e.at)}</span>}
            <button type="button" onClick={copy} className="rounded p-1 hover:bg-muted" aria-label="Copy">{copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}</button>
            {canReplay && <button type="button" onClick={() => onReplay(e.text)} className="rounded p-1 hover:bg-muted" aria-label="Say it again"><RotateCcw className="h-3.5 w-3.5" /></button>}
          </div>
        )}
        {e.cards?.map((c, j) => <AssistantCardView key={j} card={c} disabled={busy} onAnswer={onAnswer} theme={theme} />)}
      </div>
    </div>
  )
}

function DroppedNote({ dropped, onSend }: { dropped: Dropped; onSend: () => void }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-tr-sm border border-dashed px-3 py-2 text-muted-foreground">
        <p className="italic">“{dropped.text}”</p>
        <p className="mt-1 text-xs">
          {dropped.reason === 'too_quiet' ? 'Ignored: sounded far away (Settings → Ignore far-away voices).' : 'Ignored: I wasn’t sure I heard that right.'}{' '}
          <button type="button" className="font-medium text-foreground underline" onClick={onSend}>That was me, send it</button>
        </p>
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

function AssistantCardView({ card, disabled, onAnswer, theme }: { card: Card; disabled: boolean; onAnswer: (t: string) => void; theme: typeof THEMES[keyof typeof THEMES] }) {
  const accent = { background: `linear-gradient(135deg, ${theme.from}, ${theme.to})` }
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
          <button type="button" disabled={disabled} onClick={() => onAnswer('Haan, confirm kar do.')}
            className="h-10 flex-1 rounded-lg px-3 text-sm font-medium text-white disabled:opacity-50" style={accent}>Confirm</button>
          <Button variant="outline" className="h-10 flex-1" disabled={disabled} onClick={() => onAnswer('Nahi, abhi cancel karo.')}>Cancel</Button>
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
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg px-3 text-white" style={accent}>
            <MessageCircle className="h-4 w-4" />Send to customer on WhatsApp
          </a>
        )}
        <a href={card.whatsapp_pick_chat} target="_blank" rel="noreferrer"
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border px-3">
          <MessageCircle className="h-4 w-4" />Send to me / pick a chat
        </a>
        <a href={card.pdf_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs underline">
          View PDF <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </div>
  )
}

