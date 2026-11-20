'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Mic, Square, Send, Loader2, Volume2, VolumeX, Plus, Sparkles, ExternalLink, MessageCircle } from 'lucide-react'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { apiFetch } from '@/lib/api-client'
import { useRole } from '@/lib/auth/useRole'
import { cn } from '@/lib/utils'
import { useVoice } from './useVoice'

// DB, the owner's voice secretary. A floating button opens this panel from any
// dashboard page; tap the mic, speak, and DB answers aloud. Every save shows a
// confirmation card first (see lib/assistant/tools.ts).

type Card =
  | { type: 'confirm'; action_id: string; title: string; summary: string; warnings: string[] }
  | { type: 'done'; title: string; detail: string; link?: string | null }
  | { type: 'share'; title: string; pdf_url: string; whatsapp_to_customer: string | null; whatsapp_pick_chat: string }

type Entry = { role: 'owner' | 'db'; text: string; cards?: Card[] }

const THREAD_KEY = 'db_assistant_thread'
const VOICE_KEY = 'db_assistant_voice'
const STATUS_WORDS: Record<string, string> = {
  find_customer: 'Customer dekh rahi hoon…',
  find_products: 'Stock check kar rahi hoon…',
  find_sellable_units: 'Units dekh rahi hoon…',
  find_unit_by_serial: 'Serial dhoondh rahi hoon…',
  price_context: 'Purane rates dekh rahi hoon…',
  confirm_pending_action: 'Save kar rahi hoon…',
  share_document_on_whatsapp: 'PDF bana rahi hoon…',
}

function readStore(key: string) { try { return localStorage.getItem(key) } catch { return null } }
function writeStore(key: string, value: string | null) {
  try { value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value) } catch { /* private mode */ }
}

export function AssistantLauncher() {
  const { isOwner, loading } = useRole()
  const [open, setOpen] = useState(false)
  if (loading || !isOwner) return null
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Talk to DB"
        className="fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg hover:opacity-90"
      >
        <Sparkles className="h-6 w-6" />
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
          {open && <AssistantConversation />}
        </SheetContent>
      </Sheet>
    </>
  )
}

function AssistantConversation() {
  const [threadId, setThreadId] = useState<string | null>(null)
  const [entries, setEntries] = useState<Entry[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [setup, setSetup] = useState<{ ready: boolean; reason?: string } | null>(null)
  const [voiceOn, setVoiceOn] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)

  const send = useCallback(async (text: string) => {
    if (!text.trim() || busy) return
    setError(null)
    setBusy(true)
    setDraft('')
    setEntries((prev) => [...prev, { role: 'owner', text }, { role: 'db', text: '', cards: [] }])
    let reply = ''
    try {
      const res = await apiFetch('/api/assistant/turn', {
        method: 'POST',
        body: JSON.stringify({ text, thread_id: threadId }),
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
    } finally {
      setBusy(false)
      setStatus(null)
      if (voiceOn && reply.trim()) voice.speak(reply)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, threadId, voiceOn])

  const voice = useVoice((t) => send(t))

  useEffect(() => {
    setVoiceOn(readStore(VOICE_KEY) !== 'off')
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

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }) }, [entries, status])

  const wakeDb = async () => {
    const r = await apiFetch('/api/assistant/setup', { method: 'POST' })
    const j = await r.json()
    if (!r.ok) setError(j.error || 'Could not set up DB.')
    setSetup(j)
  }

  const newConversation = () => { writeStore(THREAD_KEY, null); setThreadId(null); setEntries([]); setError(null) }
  const toggleVoice = () => { const next = !voiceOn; setVoiceOn(next); writeStore(VOICE_KEY, next ? 'on' : 'off'); if (!next) voice.stopSpeaking() }

  return (
    <>
      <SheetHeader className="border-b px-4 py-3">
        <div className="flex items-center justify-between gap-2 pr-8">
          <div>
            <SheetTitle>DB</SheetTitle>
            <SheetDescription className="text-xs">Your assistant. Nothing is saved until you say yes.</SheetDescription>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={toggleVoice} aria-label={voiceOn ? 'Mute DB' : 'Unmute DB'}>
              {voiceOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            </Button>
            <Button variant="ghost" size="sm" onClick={newConversation} aria-label="New conversation"><Plus className="h-4 w-4" /></Button>
          </div>
        </div>
      </SheetHeader>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {setup && !setup.ready && (
          <div className="rounded-md border bg-muted p-3 text-sm">
            {setup.reason === 'deactivated'
              ? <>DB is deactivated. Turn her back on in <Link href="/dashboard/settings" className="underline">Settings → Users</Link>.</>
              : <>
                  {setup.reason === 'logged_off' ? 'DB is logged off.' : 'DB is not set up yet. This creates her own ERP user, "DB", so you can see what she did.'}
                  <Button size="sm" className="mt-2 w-full" onClick={wakeDb}>{setup.reason === 'logged_off' ? 'Wake DB up' : 'Set up DB'}</Button>
                </>}
          </div>
        )}
        {entries.length === 0 && setup?.ready && (
          <p className="text-sm text-muted-foreground">Try: “ABC ke liye PI bana do, HP EliteBook 840 G6 8/256” or “Aaj 450 ka petrol, cash se, Ankit ne diya”.</p>
        )}
        {entries.map((e, i) => (
          <div key={i} className={cn('flex flex-col gap-2', e.role === 'owner' ? 'items-end' : 'items-start')}>
            {(e.text || e.role === 'owner') && (
              <div className={cn('max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm',
                e.role === 'owner' ? 'bg-primary text-primary-foreground' : 'bg-muted')}>{e.text}</div>
            )}
            {e.cards?.map((c, j) => <AssistantCardView key={j} card={c} disabled={busy} onAnswer={send} />)}
          </div>
        ))}
        {status && <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />{status}</p>}
        {voice.interim && <p className="text-right text-sm italic text-muted-foreground">{voice.interim}</p>}
        {error && <p className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">{error}</p>}
      </div>

      <div className="border-t p-3">
        <div className="flex items-center gap-2">
          {voice.supported && (
            <Button
              type="button"
              size="lg"
              variant={voice.listening ? 'destructive' : 'default'}
              className="h-12 w-12 shrink-0 rounded-full p-0"
              disabled={busy || !setup?.ready}
              onClick={() => (voice.listening ? voice.stop() : voice.start())}
              aria-label={voice.listening ? 'Stop listening' : 'Talk to DB'}
            >
              {voice.listening ? <Square className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
            </Button>
          )}
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send(draft)}
            placeholder={voice.supported ? 'Tap the mic, or type…' : 'Type to DB…'}
            disabled={busy || !setup?.ready}
          />
          <Button size="sm" onClick={() => send(draft)} disabled={busy || !draft.trim() || !setup?.ready} aria-label="Send">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </>
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
      <div className="w-full max-w-[85%] rounded-md border bg-background p-3 text-sm">
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
      <div className="w-full max-w-[85%] rounded-md border border-success/30 bg-success/10 p-3 text-sm">
        <p className="font-medium">✓ {card.title}</p>
        <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{card.detail}</p>
      </div>
    )
  }
  return (
    <div className="w-full max-w-[85%] rounded-md border bg-background p-3 text-sm">
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
