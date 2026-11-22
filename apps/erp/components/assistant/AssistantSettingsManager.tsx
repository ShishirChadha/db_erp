'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Loader2, Play, ExternalLink, Mic, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { apiFetch } from '@/lib/api-client'
import { cn } from '@/lib/utils'
import { useAsyncAction } from '@/lib/useAsyncAction'
import AssistantLearnings from './AssistantLearnings'
import AssistantLookSettings from './AssistantLookSettings'
import { useVoice, useNameTrainer, createMeter, GATE_LEVEL, type SpeakProvider, type VoiceGate } from './useVoice'

// Settings -> DB Assistant. Only DB's master sees this tab (the config route
// answers 403 to everyone else). Stacked sections, no tab strip.

type Money = { usd: number; inr: number }
type Attempt<T> = { ok: true; data: T } | { ok: false; error: string } | null
type VoiceOpt = { id: string; label: string }
type Billing = {
  month: { usd: number; by_model: Record<string, number>; data_refreshed_at: string | null }
  today: { usd: number; tokens: number }
  since: { usd: number; data_refreshed_at: string | null } | null
}
type Config = {
  settings: any
  secrets: Record<'sarvam' | 'azure' | 'google' | 'anthropic_admin' | 'anthropic', { configured: boolean; from_env: boolean; unreadable?: boolean }>
  status: { ready: boolean; reason?: string }
  owners: { id: string; full_name: string | null; username: string | null }[]
  me: string
  voices: { sarvam: VoiceOpt[]; azure: Attempt<VoiceOpt[]>; google: Attempt<VoiceOpt[]> }
  models: string[]
  read_modules: { key: string; label: string; hint: string }[]
  write_skills: { key: string; label: string; hint: string }[]
  other_ai: { feature: string; model: string }[]
  fx: { rate: number; date: string | null; source: string }
  usage: {
    today: { claude: Money; sarvam: Money }
    month: { claude: Money; sarvam: Money }
    since_credit: { claude: Money; sarvam: Money } | null
    conversations_this_month: number
    free_voice_chars_month: { azure: number; google: number }
    free_listen_seconds_month?: { azure: number }
  }
  free_tts_chars: { azure_tts: number; google_tts: number }
  anthropic_billing: Attempt<Billing>
}

const inr = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: n < 100 ? 2 : 0 })}`
const usd = (n: number) => `$${n.toFixed(n < 10 ? 3 : 2)}`
const when = (iso: string | null) => iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : 'not yet'
// Per-conversation costs are rough: a typical 3-4 reply conversation with a
// lookup or two, list prices, instructions already cached.
const MODELS: Record<string, { name: string; level: string; cost: string; note: string }> = {
  'claude-opus-5-5': { name: 'Opus 5.5', level: 'High', cost: '≈ ₹3–8 a conversation', note: 'Sharpest judgement on prices, tricky Hinglish and multi-step jobs. Use when mistakes are costly.' },
  'claude-sonnet-5-5': { name: 'Sonnet 5.5', level: 'Medium', cost: '≈ ₹1.5–4 a conversation', note: 'Half of Opus. Very good at everyday PIs, sales, expenses and reports. A good start while she learns your ways.' },
  'claude-haiku-5-5': { name: 'Haiku 5.5', level: 'Low', cost: '≈ ₹0.10–0.25 a conversation', note: 'About 20× cheaper than Sonnet and faster. Fine for repeated, routine work and questions; more likely to miss a detail or misread Hinglish, so read her confirmation cards carefully. No automatic backup model if a request is refused.' },
}
const PROVIDER_LABELS: Record<SpeakProvider, string> = {
  azure: 'Microsoft Azure', google: 'Google Cloud', sarvam: 'Sarvam AI', browser: 'Browser (free, robotic)',
}
const PREVIEW = {
  devanagari: 'हाय Shishir! मैं DB हूँ। बताइए, आज कौन सा PI बनाना है? और हाँ, coffee पी ली या नहीं?',
  roman: 'Hi Shishir! Main DB hoon. Bataiye, aaj kaunsa PI banana hai?',
  english: 'Hi Shishir! It’s DB. Your PI for Limo Auto is ready, shall I send it on WhatsApp?',
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3 rounded-md border border-border p-4">
      <div>
        <h3 className="font-medium">{title}</h3>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </div>
  )
}

function KeyField({ label, configured, fromEnv, value, onChange, placeholder, onRemove }: {
  label: string; configured: boolean; fromEnv: boolean; value: string; onChange: (v: string) => void; placeholder: string; onRemove: () => void
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {fromEnv ? <p className="text-xs text-muted-foreground">Set on the server.</p> : (
        <div className="flex gap-2">
          <Input type="password" value={value} onChange={(e) => onChange(e.target.value)} placeholder={configured ? 'Saved — paste a new one to replace' : placeholder} />
          {configured && <Button variant="outline" size="sm" onClick={onRemove}>Remove</Button>}
        </div>
      )}
    </div>
  )
}

// Live mic level for 10 seconds against the filter levels, so the owner can
// see where his normal voice lands (and where the room noise is).
function MicCheck({ gate }: { gate: VoiceGate }) {
  const [on, setOn] = useState(false)
  const [peak, setPeak] = useState(0)
  const [err, setErr] = useState<string | null>(null)
  const bar = useRef<HTMLDivElement>(null)
  const max = 0.08 // full width of the bar
  const start = async () => {
    setErr(null); setPeak(0)
    let meter: ReturnType<typeof createMeter>
    try {
      meter = createMeter(await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false } }), { current: 0 })
    } catch { setErr('Microphone permission is blocked.'); return }
    setOn(true)
    let top = 0
    const t0 = Date.now()
    const tick = () => {
      const l = meter.read()
      top = Math.max(top, l)
      if (bar.current) bar.current.style.width = `${Math.min(100, (l / max) * 100)}%`
      if (Date.now() - t0 < 10_000) requestAnimationFrame(tick)
      else { meter.stop(); setOn(false); setPeak(top); if (!meter.working()) setErr('The mic read pure silence: check the input device in your Mac’s sound settings.') }
    }
    requestAnimationFrame(tick)
  }
  const mark = (v: number) => `${Math.min(100, (v / max) * 100)}%`
  return (
    <div className="rounded-md bg-muted p-3 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-sm">Mic check</span>
        <Button variant="outline" size="sm" onClick={start} disabled={on}><Mic className="mr-1 h-3.5 w-3.5" />{on ? 'Talk normally…' : 'Test for 10 s'}</Button>
      </div>
      <div className="relative mt-2 h-3 overflow-hidden rounded-full bg-background">
        <div ref={bar} className="h-full w-0 rounded-full bg-emerald-500 transition-[width] duration-75" />
        {(['low', 'medium', 'high'] as const).map((g) => (
          <div key={g} className={cn('absolute top-0 h-full w-0.5', g === gate ? 'bg-foreground' : 'bg-muted-foreground/40')} style={{ left: mark(GATE_LEVEL[g]) }} title={g} />
        ))}
      </div>
      <p className="mt-1 text-muted-foreground">Lines: low · medium · high (the dark one is your setting). Your normal voice should go well past it; room noise and people across the room should stay below.</p>
      {peak > 0 && <p className="mt-1">Your loudest: {peak.toFixed(3)} — {peak < GATE_LEVEL[gate] ? <b className="text-destructive">below your setting, she would ignore you: pick a lower level</b> : 'fine for your setting'}.</p>}
      {err && <p className="mt-1 text-destructive">{err}</p>}
    </div>
  )
}

export default function AssistantSettingsManager() {
  const [cfg, setCfg] = useState<Config | null>(null)
  const [s, setS] = useState<any>(null)
  const [keys, setKeys] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const load = async () => {
    const r = await apiFetch('/api/assistant/config', { timeoutMs: 60_000 })
    if (!r.ok) { setErr((await r.json().catch(() => ({}))).error || 'Not available.'); return }
    const j: Config = await r.json()
    setCfg(j)
    setS({ ...j.settings, wake_phrases_text: (j.settings.wake_phrases || []).join(', ') })
  }
  useEffect(() => { load() }, [])

  const preview = useVoice({ listen: 'browser', speak: 'browser', speakReplies: true }, () => {})
  const trainer = useNameTrainer()

  const put = async (body: any) => {
    const r = await apiFetch('/api/assistant/config', { method: 'PUT', body: JSON.stringify(body) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.error || 'Could not save.')
    window.dispatchEvent(new Event('db-assistant-settings'))
  }

  const save = useAsyncAction(async () => {
    setErr(null); setMsg(null)
    const body: any = {
      master_profile_ids: s.master_profile_ids, model: s.model,
      voice_provider: s.voice_provider, listen_provider: s.listen_provider, azure_stt_language: s.azure_stt_language,
      tts_speaker: s.tts_speaker, azure_voice: s.azure_voice, google_voice: s.google_voice, azure_region: s.azure_region,
      tts_pace: Number(s.tts_pace), speak_replies: s.speak_replies,
      wake_word: s.wake_word,
      wake_phrases: String(s.wake_phrases_text || '').split(',').map((x: string) => x.trim()).filter(Boolean),
      hinglish_script: s.hinglish_script,
      tone: s.tone,
      call_me: s.call_me,
      wake_reply: s.wake_reply,
      reply_length: s.reply_length,
      write_skills: s.write_skills,
      appearance: s.appearance,
      continuous_conversation: s.continuous_conversation,
      conversation_idle_seconds: Number(s.conversation_idle_seconds),
      voice_gate: s.voice_gate,
      read_modules: s.read_modules,
      anthropic_credit_usd: s.anthropic_credit_usd === '' || s.anthropic_credit_usd == null ? null : Number(s.anthropic_credit_usd),
      sarvam_credit_inr: s.sarvam_credit_inr === '' || s.sarvam_credit_inr == null ? null : Number(s.sarvam_credit_inr),
      credit_since: s.credit_since || null,
    }
    for (const [k, v] of Object.entries(keys)) if (v.trim()) body[k] = v.trim()
    try { await put(body) } catch (e) { setErr((e as Error).message); return }
    setKeys({})
    setMsg('Saved.')
    await load()
  })

  const removeKey = async (field: string) => {
    try { await put({ [field]: null }) } catch (e) { setErr((e as Error).message) }
    await load()
  }

  const wake = useAsyncAction(async () => {
    const r = await apiFetch('/api/assistant/setup', { method: 'POST' })
    if (!r.ok) setErr((await r.json().catch(() => ({}))).error || 'Could not set up DB.')
    await load()
  })


  if (err && !cfg) return <p className="text-sm text-muted-foreground">{err}</p>
  if (!cfg || !s) return <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>

  const set = (k: string, v: unknown) => setS((prev: any) => ({ ...prev, [k]: v }))
  const setKey = (k: string, v: string) => setKeys((prev) => ({ ...prev, [k]: v }))
  const vp: SpeakProvider = s.voice_provider
  const voiceList = (p: 'azure' | 'google'): VoiceOpt[] => {
    const a = cfg.voices[p]
    return a && a.ok ? a.data : []
  }
  const voiceError = (p: 'azure' | 'google') => { const a = cfg.voices[p]; return a && !a.ok ? a.error : null }
  const currentVoice = vp === 'azure' ? s.azure_voice : vp === 'google' ? s.google_voice : s.tts_speaker
  const canPreview = vp !== 'browser' && cfg.secrets[vp].configured
  const playPreview = (text: string) => preview.speak(text, { provider: vp, voice: currentVoice, pace: Number(s.tts_pace) })

  const u = cfg.usage
  const billing = cfg.anthropic_billing
  const billed = billing && billing.ok ? billing.data : null
  const loaded = s.anthropic_credit_usd === '' || s.anthropic_credit_usd == null ? null : Number(s.anthropic_credit_usd)
  const anthropicLeft = loaded != null && billed?.since ? loaded - billed.since.usd : null
  const sarvamLoaded = s.sarvam_credit_inr === '' || s.sarvam_credit_inr == null ? null : Number(s.sarvam_credit_inr)
  const sarvamLeft = sarvamLoaded != null && u.since_credit ? sarvamLoaded - u.since_credit.sarvam.inr : null

  return (
    <div className="space-y-4">
      {Object.entries(cfg.secrets).some(([, v]) => v.unreadable) && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <b>Some saved keys can’t be unlocked on this server:</b> {Object.entries(cfg.secrets).filter(([, v]) => v.unreadable).map(([k]) => k).join(', ')}.
          Keys are stored encrypted with PASSWORD_VAULT_KEY. This server’s copy is missing or different from the one they were saved with.
          Fix: add PASSWORD_VAULT_KEY in Vercel with the same value as the laptop’s, then redeploy. (Or paste the keys again here, but then the laptop can’t read them.)
        </div>
      )}
      <Section title="DB and who can talk to her" hint="DB only answers the logins ticked here. Everyone else doesn't even see her button.">
        <p className="text-sm">
          Status:{' '}
          {cfg.status.ready ? <span className="text-success">awake</span>
            : cfg.status.reason === 'deactivated' ? <span className="text-destructive">deactivated in Users & Access</span>
            : cfg.status.reason === 'logged_off' ? <span className="text-warning">logged off</span>
            : <span className="text-muted-foreground">not set up</span>}
          {!cfg.status.ready && cfg.status.reason !== 'deactivated' && (
            <Button size="sm" className="ml-3" onClick={() => wake.run()} loading={wake.pending}>{cfg.status.reason === 'logged_off' ? 'Wake DB up' : 'Set up DB'}</Button>
          )}
        </p>
        <div className="space-y-2">
          {cfg.owners.map((o) => (
            <label key={o.id} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={s.master_profile_ids.includes(o.id)}
                disabled={o.id === cfg.me}
                onCheckedChange={(c) => set('master_profile_ids', c ? [...s.master_profile_ids, o.id] : s.master_profile_ids.filter((x: string) => x !== o.id))}
              />
              {o.full_name || o.username || 'Owner'} {o.id === cfg.me && <span className="text-xs text-muted-foreground">(you)</span>}
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          To stop her completely, log off “DB assistant (server)” in Active Devices, or deactivate the user “DB”.{' '}
          <Link href="/dashboard/assistant" className="underline">Her conversations →</Link>
        </p>
      </Section>

      <Section title="Look and feel" hint="How DB looks and behaves on screen. Changes show in the preview straight away and on her panel after Save changes.">
        <AssistantLookSettings value={s.appearance} onChange={(v) => set('appearance', v)} />
      </Section>

      <Section title="Brain" hint="The AI model DB thinks with. You can change it any time; her learnings, checks and confirmation cards stay the same whichever you pick.">
        <div className="space-y-2">
          {cfg.models.map((m) => {
            const info = MODELS[m]
            return (
              <label key={m} className={cn('flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm', s.model === m && 'border-primary bg-primary/5')}>
                <input type="radio" name="model" className="mt-1" checked={s.model === m} onChange={() => set('model', m)} />
                <span className="min-w-0">
                  <span className="font-medium">{info?.name || m}</span>{info && <span className="text-muted-foreground"> · {info.level} · {info.cost}</span>}
                  {info && <span className="block text-xs text-muted-foreground">{info.note}</span>}
                </span>
              </label>
            )
          })}
        </div>
        {cfg.secrets.anthropic.from_env
          ? <p className="text-xs text-success">Anthropic API key: set on this server.</p>
          : (
            <div className="space-y-1">
              {!cfg.secrets.anthropic.configured && <p className="text-xs text-destructive">This server has no Anthropic API key, so DB can’t think here. Best: add ANTHROPIC_API_KEY in Vercel (it also powers Marketing and bank statements). Or paste it below for DB only.</p>}
              <KeyField label="Anthropic API key (for DB only)" configured={cfg.secrets.anthropic.configured} fromEnv={false}
                value={keys.anthropic_key || ''} onChange={(v) => setKey('anthropic_key', v)} placeholder="sk-ant-api…" onRemove={() => removeKey('anthropic_key')} />
            </div>
          )}
        <p className="text-xs text-muted-foreground">
          Plan that works: start on Medium for a week or two, add learnings whenever she gets something wrong, then try Low. If Low starts slipping on something, switch back. It takes effect from her next reply.
          She doesn’t get smarter on her own: what improves is her learnings and the ERP’s history she reads, and those carry over to any model.
        </p>
      </Section>

      <Section title="Her voice (speaking)" hint="Who reads DB's replies out loud. Azure and Google are free within their monthly allowance; try each with Preview.">
        <div className="grid gap-1 text-sm sm:grid-cols-2">
          {(['azure', 'google', 'sarvam', 'browser'] as SpeakProvider[]).map((p) => (
            <label key={p} className="flex items-center gap-2">
              <input type="radio" name="voice_provider" checked={vp === p} onChange={() => set('voice_provider', p)} />
              {PROVIDER_LABELS[p]}{p !== 'browser' && !cfg.secrets[p].configured && <span className="text-xs text-muted-foreground">(no key)</span>}
            </label>
          ))}
        </div>

        {vp === 'azure' && (
          <div className="space-y-2">
            <KeyField label="Azure Speech key" configured={cfg.secrets.azure.configured} fromEnv={cfg.secrets.azure.from_env}
              value={keys.azure_key || ''} onChange={(v) => setKey('azure_key', v)} placeholder="Key 1 from your Azure Speech resource" onRemove={() => removeKey('azure_key')} />
            <Label className="text-xs">Azure region (where you created the Speech resource)</Label>
            <Input value={s.azure_region} onChange={(e) => set('azure_region', e.target.value.toLowerCase().replace(/\s/g, ''))} placeholder="centralindia" />
            {voiceError('azure') && <p className="text-xs text-destructive">{voiceError('azure')}</p>}
            {voiceList('azure').length > 0 && (
              <select value={s.azure_voice} onChange={(e) => set('azure_voice', e.target.value)} className="h-8 w-full rounded-md border bg-background px-2 text-sm">
                {voiceList('azure').map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
              </select>
            )}
            <p className="text-xs text-muted-foreground">Free: {u.free_voice_chars_month.azure.toLocaleString('en-IN')} of {cfg.free_tts_chars.azure_tts.toLocaleString('en-IN')} characters used this month (Azure F0 tier).</p>
          </div>
        )}
        {vp === 'google' && (
          <div className="space-y-2">
            <KeyField label="Google Cloud API key (Text-to-Speech enabled)" configured={cfg.secrets.google.configured} fromEnv={cfg.secrets.google.from_env}
              value={keys.google_key || ''} onChange={(v) => setKey('google_key', v)} placeholder="AIza…" onRemove={() => removeKey('google_key')} />
            {voiceError('google') && <p className="text-xs text-destructive">{voiceError('google')}</p>}
            {voiceList('google').length > 0 && (
              <select value={s.google_voice} onChange={(e) => set('google_voice', e.target.value)} className="h-8 w-full rounded-md border bg-background px-2 text-sm">
                {voiceList('google').map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
              </select>
            )}
            <p className="text-xs text-muted-foreground">Free: {u.free_voice_chars_month.google.toLocaleString('en-IN')} of about {cfg.free_tts_chars.google_tts.toLocaleString('en-IN')} Chirp 3 HD characters used this month.</p>
          </div>
        )}
        {vp === 'sarvam' && (
          <div className="space-y-2">
            <KeyField label="Sarvam API key" configured={cfg.secrets.sarvam.configured} fromEnv={cfg.secrets.sarvam.from_env}
              value={keys.sarvam_key || ''} onChange={(v) => setKey('sarvam_key', v)} placeholder="From dashboard.sarvam.ai" onRemove={() => removeKey('sarvam_key')} />
            <select value={s.tts_speaker} onChange={(e) => set('tts_speaker', e.target.value)} className="h-8 w-full rounded-md border bg-background px-2 text-sm">
              {cfg.voices.sarvam.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
            </select>
          </div>
        )}

        {vp !== 'browser' && (
          <>
            <Label className="text-xs">Speed: {Number(s.tts_pace).toFixed(2)}×</Label>
            <input type="range" min={0.8} max={1.4} step={0.05} value={s.tts_pace} onChange={(e) => set('tts_pace', Number(e.target.value))} className="w-full" />
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" disabled={!canPreview || preview.speaking} onClick={() => playPreview(PREVIEW.devanagari)}><Play className="mr-1 h-3.5 w-3.5" />Hinglish</Button>
              <Button variant="outline" size="sm" disabled={!canPreview || preview.speaking} onClick={() => playPreview(PREVIEW.english)}><Play className="mr-1 h-3.5 w-3.5" />English</Button>
              {!canPreview && <span className="self-center text-xs text-muted-foreground">Save the key first, then preview.</span>}
            </div>
          </>
        )}
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={s.speak_replies} onCheckedChange={(c) => set('speak_replies', !!c)} />Speak her replies out loud
        </label>
      </Section>

      <Section title="Hearing you (listening)" hint="Who turns your speech into text. The browser is free but works properly only in Chrome; Azure works in every browser (DuckDuckGo too) and understands Indian English and Hindi well.">
        <div className="grid gap-1.5 text-sm sm:grid-cols-3">
          {([
            ['browser', 'Browser (free)', 'Chrome only; also powers “Hey DB”'],
            ['azure', 'Microsoft Azure', 'Any browser; 5 free hours a month'],
            ['sarvam', 'Sarvam AI', 'Paid; best at mixed Hinglish'],
          ] as const).map(([p, label, hint]) => (
            <label key={p} className={cn('flex cursor-pointer items-start gap-2 rounded-md border p-2', s.listen_provider === p && 'border-primary bg-primary/5')}>
              <input type="radio" name="listen_provider" className="mt-0.5" checked={s.listen_provider === p} onChange={() => set('listen_provider', p)} />
              <span>{label}<span className="block text-xs text-muted-foreground">{hint}</span></span>
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          In a browser whose own speech recognition doesn’t work (DuckDuckGo, in-app browsers), DB switches to Azure by herself when the Azure key is saved — you don’t need to change anything here.
          “Hey DB” always needs Chrome.
        </p>
        {s.listen_provider === 'azure' && (
          <div className="space-y-2">
            {!cfg.secrets.azure.configured && (
              <KeyField label="Azure Speech key (same key as her voice)" configured={false} fromEnv={false}
                value={keys.azure_key || ''} onChange={(v) => setKey('azure_key', v)} placeholder="Key 1 from your Azure Speech resource" onRemove={() => removeKey('azure_key')} />
            )}
            <Label className="text-xs">Azure listens for</Label>
            <div className="space-y-1 text-sm">
              <label className="flex items-center gap-2"><input type="radio" name="stt_lang" checked={s.azure_stt_language !== 'hi-IN'} onChange={() => set('azure_stt_language', 'en-IN')} />English (India) — writes Hindi words in English letters</label>
              <label className="flex items-center gap-2"><input type="radio" name="stt_lang" checked={s.azure_stt_language === 'hi-IN'} onChange={() => set('azure_stt_language', 'hi-IN')} />Hindi — writes everything in हिंदी, English words included</label>
            </div>
            <p className="text-xs text-muted-foreground">Free: {Math.round((u.free_listen_seconds_month?.azure || 0) / 60)} of 300 minutes used this month (Azure F0). When the free hours run out, Azure simply stops until next month — no charge.</p>
          </div>
        )}
        {s.listen_provider === 'sarvam' && vp !== 'sarvam' && (
          <KeyField label="Sarvam API key" configured={cfg.secrets.sarvam.configured} fromEnv={cfg.secrets.sarvam.from_env}
            value={keys.sarvam_key || ''} onChange={(v) => setKey('sarvam_key', v)} placeholder="From dashboard.sarvam.ai" onRemove={() => removeKey('sarvam_key')} />
        )}
        {s.listen_provider === 'sarvam' && !cfg.secrets.sarvam.configured && <p className="text-xs text-warning">No Sarvam key — DB listens with the browser until you add one.</p>}
      </Section>

      <Section title="Language and tone" hint="DB answers in the language you speak: English gets English, Hindi or Hinglish gets Hinglish.">
        <div className="space-y-1 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" name="script" checked={s.hinglish_script === 'devanagari'} onChange={() => set('hinglish_script', 'devanagari')} />
            Hinglish in हिंदी + English script (most natural voice)
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="script" checked={s.hinglish_script === 'roman'} onChange={() => set('hinglish_script', 'roman')} />
            Hinglish in Roman letters (easier to read, voice less natural)
          </label>
        </div>
        <Label className="text-xs">Personality</Label>
        <div className="space-y-1 text-sm">
          {([
            ['casual', 'Very casual: like a friend who runs your office (teases you a little, chatty)'],
            ['friendly', 'Friendly: warm colleague, light humour now and then'],
            ['professional', 'Professional: polished executive assistant'],
          ] as const).map(([v, label]) => (
            <label key={v} className="flex items-center gap-2">
              <input type="radio" name="tone" checked={s.tone === v} onChange={() => set('tone', v)} />{label}
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">She is always serious while reading back money, when something fails, and in anything that goes to a customer.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">She calls you</Label>
            <Input value={s.call_me ?? ''} onChange={(e) => set('call_me', e.target.value)} placeholder="Boss" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">When you say “Hey DB”, she answers</Label>
            <Input value={s.wake_reply ?? ''} onChange={(e) => set('wake_reply', e.target.value)} placeholder="Yes Boss?" />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">The wake answer is played from memory after the first time, so it is instant and costs nothing. Leave it empty to have her just start listening.</p>
        <Label className="text-xs">How much she says</Label>
        <div className="space-y-1 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" name="reply_length" checked={s.reply_length === 'short'} onChange={() => set('reply_length', 'short')} />
            Short: just the answer, no explanations (cheaper and quicker)
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="reply_length" checked={s.reply_length === 'normal'} onChange={() => set('reply_length', 'normal')} />
            Normal: a little more context
          </label>
        </div>
        <p className="text-xs text-muted-foreground">Either way, say “stop”, “bas”, “ruko” or “pata hai” while she talks (or press Esc, or tap the mic) and she stops at once.</p>
      </Section>

      <Section title="Conversation" hint="Talk to DB like a person: tap the mic once (or say “Hey DB”), and after each answer she listens again by herself.">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={s.continuous_conversation} onCheckedChange={(c) => set('continuous_conversation', !!c)} />Keep listening after each reply (no tapping between sentences)
        </label>
        <Label className="text-xs">End the conversation after {s.conversation_idle_seconds} seconds of quiet</Label>
        <input type="range" min={6} max={60} step={1} value={s.conversation_idle_seconds} onChange={(e) => set('conversation_idle_seconds', Number(e.target.value))} className="w-full" />
        <p className="text-xs text-muted-foreground">You can also end it by saying “bas”, “bye” or “thank you”, by tapping End, or by closing her panel.</p>
        <Label className="text-xs">Ignore other people and far-away voices</Label>
        <div className="grid gap-1 text-sm sm:grid-cols-2">
          {([
            ['off', 'Off: hear everything'],
            ['low', 'Low: ignore very faint sound'],
            ['medium', 'Medium: ignore people across the room (recommended)'],
            ['high', 'High: only someone close to the mic'],
          ] as const).map(([v, label]) => (
            <label key={v} className="flex items-center gap-2">
              <input type="radio" name="voice_gate" checked={s.voice_gate === v} onChange={() => set('voice_gate', v)} />{label}
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Works on loudness: speech quieter than this, lone “hmm/uh”, and words the recogniser is unsure of are dropped, and she keeps listening.
          It can’t tell your voice from someone standing right next to you. That needs voice-print matching, which adds roughly half a second to every sentence and a paid service, so it is not switched on.
          If she misses you when you speak softly, lower this. Anything she ignores shows up in her panel with a “That was me, send it” button.
        </p>
        <MicCheck gate={s.voice_gate} />
      </Section>

      <Section title="What DB can do" hint="Her skills. Switch one off and she won't do it — she'll tell you it's off and point you to the ERP page instead.">
        <div className="space-y-2">
          {cfg.write_skills.map((k) => (
            <label key={k.key} className="flex items-start gap-2 text-sm">
              <Checkbox className="mt-0.5" checked={s.write_skills.includes(k.key)}
                onCheckedChange={(c) => set('write_skills', c ? [...s.write_skills, k.key] : s.write_skills.filter((x: string) => x !== k.key))} />
              <span><span className="font-medium">{k.label}</span><span className="block text-xs text-muted-foreground">{k.hint}</span></span>
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">Whatever is on, nothing is saved without your yes on a confirmation card.</p>
      </Section>

      <Section title="What DB can read" hint="Switch on the parts of the ERP DB may look at to answer your questions (“aaj ki sale?”, “kitne 840 G6 ready hain?”, “kiske payments due hain?”). She only reads; saving still needs your yes.">
        <div className="space-y-2">
          {cfg.read_modules.map((m) => (
            <label key={m.key} className="flex items-start gap-2 text-sm">
              <Checkbox className="mt-0.5" checked={s.read_modules.includes(m.key)}
                onCheckedChange={(c) => set('read_modules', c ? [...s.read_modules, m.key] : s.read_modules.filter((x: string) => x !== m.key))} />
              <span><span className="font-medium">{m.label}</span><span className="block text-xs text-muted-foreground">{m.hint}</span></span>
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Cost: switching these on costs nothing until she uses one. Each question that reads a report adds about ₹0.30–₹1.50 (the figures she reads are billed as input) and about 1–2 seconds.
          Results are capped to the top rows, so a big report never gets expensive. Switching a module off makes her prompt slightly smaller, but the saving is tiny.
        </p>
      </Section>

      <Section title="“Hey DB” wake word" hint="Say a wake phrase and DB opens and starts listening — no tapping. Works while the ERP is open on screen (laptop, or a phone with the screen on).">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={s.wake_word} onCheckedChange={(c) => set('wake_word', !!c)} />Listen for my wake phrase on this ERP
        </label>
        <Input value={s.wake_phrases_text} onChange={(e) => set('wake_phrases_text', e.target.value)} placeholder="hey db, db suno" />
        <p className="text-xs text-muted-foreground">Comma-separated. A green dot on DB’s button means she is listening for it. “DB” is hard for speech recognition (it hears IDBI, TP, TV…); common mishearings already work, and you can teach her more below.</p>
        <div className="rounded-md bg-muted p-3">
          <p className="text-sm font-medium">Teach DB her name</p>
          <p className="text-xs text-muted-foreground">Tap, say “Hi DB” the way you normally do, and repeat 2–3 times. Then add what she heard. Free, uses the browser.</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={trainer.listen} disabled={trainer.listening}>
              <Mic className="mr-1 h-3.5 w-3.5" />{trainer.listening ? 'Listening…' : 'Say “Hi DB”'}
            </Button>
            {trainer.heard.length > 0 && (
              <Button size="sm" onClick={() => {
                const current = String(s.wake_phrases_text || '').split(',').map((x: string) => x.trim()).filter(Boolean)
                set('wake_phrases_text', [...new Set([...current, ...trainer.heard])].join(', '))
                trainer.clear()
              }}><Plus className="mr-1 h-3.5 w-3.5" />Add {trainer.heard.length} to wake phrases</Button>
            )}
          </div>
          {trainer.heard.length > 0 && <p className="mt-2 text-xs">Heard: {trainer.heard.map((h) => `“${h}”`).join(', ')}</p>}
          {trainer.error && <p className="mt-2 text-xs text-destructive">{trainer.error}</p>}
          <p className="mt-1 text-xs text-muted-foreground">Then press Save changes. Only phrases of two words or more are kept: a single word (like “idbi”) would wake her whenever someone says it.</p>
        </div>
      </Section>

      <Section title="Anthropic usage and credit (real)" hint="Read from Anthropic's own billing with an Admin API key. Covers every use of your Anthropic account — DB, Marketing, bank statements — not just DB.">
        <KeyField label="Anthropic Admin API key" configured={cfg.secrets.anthropic_admin.configured} fromEnv={cfg.secrets.anthropic_admin.from_env}
          value={keys.anthropic_admin_key || ''} onChange={(v) => setKey('anthropic_admin_key', v)} placeholder="sk-ant-admin… (Claude Console → Settings → Admin keys)" onRemove={() => removeKey('anthropic_admin_key')} />
        {billing && !billing.ok && <p className="text-xs text-destructive">{billing.error}</p>}
        {billed && (
          <div className="grid gap-2 text-sm sm:grid-cols-2">
            <div className="rounded-md bg-muted p-3">
              <p className="text-xs text-muted-foreground">Today (about 30 min behind)</p>
              <p className="text-lg font-semibold">{usd(billed.today.usd)} <span className="text-sm font-normal text-muted-foreground">{inr(billed.today.usd * cfg.fx.rate)}</span></p>
              <p className="text-xs text-muted-foreground">{billed.today.tokens.toLocaleString('en-IN')} tokens, priced at list rates</p>
            </div>
            <div className="rounded-md bg-muted p-3">
              <p className="text-xs text-muted-foreground">This month, billed by Anthropic</p>
              <p className="text-lg font-semibold">{usd(billed.month.usd)} <span className="text-sm font-normal text-muted-foreground">{inr(billed.month.usd * cfg.fx.rate)}</span></p>
              <p className="text-xs text-muted-foreground">Complete up to {when(billed.month.data_refreshed_at)}</p>
            </div>
          </div>
        )}
        {billed && Object.keys(billed.month.by_model).length > 0 && (
          <p className="text-xs text-muted-foreground">By model: {Object.entries(billed.month.by_model).sort((a, b) => b[1] - a[1]).map(([m, v]) => `${m} ${usd(v)}`).join(' · ')}</p>
        )}
        <p className="text-xs text-muted-foreground">Dollar rate: <b>₹{cfg.fx.rate.toFixed(2)}</b> per $, fetched automatically ({cfg.fx.source}{cfg.fx.date ? `, ${cfg.fx.date}` : ''}).</p>
        <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
          <b className="text-foreground">Balance:</b> Anthropic does not give out the remaining credit balance through any API (not even with the Admin key), so the ERP cannot read it.
          The exact balance is on the <a href="https://console.anthropic.com/settings/billing" target="_blank" rel="noreferrer" className="underline">Anthropic billing page</a> (top-right corner of the Console).
          Spending above is automatic.
        </p>
        <details className="text-sm">
          <summary className="cursor-pointer text-xs text-muted-foreground">Optional: estimate the balance here (enter your top-ups once)</summary>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Credit you loaded (USD)</Label>
              <Input type="number" value={s.anthropic_credit_usd ?? ''} onChange={(e) => set('anthropic_credit_usd', e.target.value)} placeholder="e.g. 20" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Loaded on</Label>
              <Input type="date" value={s.credit_since ?? ''} onChange={(e) => set('credit_since', e.target.value)} />
            </div>
          </div>
        </details>
        {anthropicLeft != null && billed?.since && (
          <p className="rounded-md border p-3 text-sm">
            Spent since {s.credit_since}: {usd(billed.since.usd)}. <b>Credit left (est.): {usd(anthropicLeft)}</b> ({inr(anthropicLeft * cfg.fx.rate)}).
            <span className="block text-xs text-muted-foreground">Anthropic does not share the balance itself through its API, so this is the credit you entered minus Anthropic’s billed spend (complete up to {when(billed.since.data_refreshed_at)}). Check the exact figure on the billing page.</span>
          </p>
        )}
        <div className="flex flex-wrap gap-3 text-xs">
          <a href="https://console.anthropic.com/settings/billing" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline">Anthropic billing <ExternalLink className="h-3 w-3" /></a>
          <a href="https://console.anthropic.com/settings/admin-keys" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline">Admin keys (team organizations only) <ExternalLink className="h-3 w-3" /></a>
        </div>
      </Section>

      <Section title="DB's own usage (live)" hint="Only DB. The ERP counts every request she makes the moment it happens, at Anthropic's list prices (and the voice services).">
        <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
          <p><b className="text-foreground">Two meters, two scopes.</b> <b>DB’s own usage</b> (here) is only DB, counted by the ERP itself, so it works without any special key and is up to the second.
            <b> Anthropic usage</b> (section above) is your whole Anthropic account as Anthropic bills it: DB plus the ERP’s other AI features below. It needs an Admin key, which Anthropic only gives team organizations.</p>
          <p className="mt-2"><b className="text-foreground">Models in use:</b> DB → {MODELS[s.model]?.name || s.model} (your choice above).{' '}
            {cfg.other_ai.map((o) => `${o.feature} → ${o.model === 'claude-sonnet-5' ? 'Sonnet 5' : o.model}`).join(' · ')}.</p>
        </div>
        <div className="grid gap-2 text-sm sm:grid-cols-2">
          <div className="rounded-md bg-muted p-3">
            <p className="text-xs text-muted-foreground">Today</p>
            <p>Brain: {usd(u.today.claude.usd)} ({inr(u.today.claude.inr)})</p>
            <p>Sarvam: {inr(u.today.sarvam.inr)}</p>
          </div>
          <div className="rounded-md bg-muted p-3">
            <p className="text-xs text-muted-foreground">This month · {u.conversations_this_month} conversations</p>
            <p>Brain: {usd(u.month.claude.usd)} ({inr(u.month.claude.inr)})</p>
            <p>Sarvam: {inr(u.month.sarvam.inr)}</p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">Sarvam credit loaded (₹)</Label>
            <Input type="number" value={s.sarvam_credit_inr ?? ''} onChange={(e) => set('sarvam_credit_inr', e.target.value)} placeholder="e.g. 100" />
          </div>
          {sarvamLeft != null && <p className="self-end text-sm">Sarvam left (est.): <b>{inr(sarvamLeft)}</b></p>}
        </div>
      </Section>

      <Section title="DB's learnings" hint="Everything DB has been taught, from your conversations or added here. Edit, pause or delete any of them; changes apply from her next reply.">
        <AssistantLearnings />
      </Section>

      <div className="sticky bottom-0 flex items-center gap-3 border-t bg-background py-3">
        <Button onClick={() => save.run()} loading={save.pending}>Save changes</Button>
        {msg && <span className="text-sm text-success">{msg}</span>}
        {err && <span className="text-sm text-destructive">{err}</span>}
      </div>
    </div>
  )
}
