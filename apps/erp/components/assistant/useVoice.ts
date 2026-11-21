'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch } from '@/lib/api-client'

// DB's ears and voice in the browser.
//
// Hearing and speaking are configured separately (Settings -> DB Assistant):
//   listen 'sarvam': the mic is recorded with MediaRecorder, stopped
//     automatically when Shishir pauses, and sent to /api/assistant/transcribe;
//   speak 'sarvam' | 'azure' | 'google': /api/assistant/speak returns her voice
//     as mp3 from that provider;
//   'browser' for either is the free built-in speech, kept as a fallback.
//
// Not catching other people: every listen measures how loud the speech was
// (raw mic level, auto-gain off). Speech quieter than the "ignore far-away
// voices" level -- someone across the room, the TV -- is dropped, and so are
// lone fillers ("hmm", "uh") and low-confidence browser results. Dropped speech
// is reported as 'ignored', so a conversation just keeps listening.

export type SpeakProvider = 'sarvam' | 'azure' | 'google' | 'browser'
export type VoiceGate = 'off' | 'low' | 'medium' | 'high'
export interface VoiceConfig {
  listen: 'sarvam' | 'browser'
  speak: SpeakProvider
  speakReplies: boolean
  gate?: VoiceGate
}
export interface VoicePreview { provider: SpeakProvider; voice: string; pace: number }
export type NothingReason = 'silence' | 'ignored' | 'error'
// What was dropped and why, so the panel can show it and offer "send it".
export interface Dropped { text: string; reason: 'too_quiet' | 'unsure' | 'filler'; peak: number; confidence: number }

type Final = (text: string, language: string | null) => void

const SILENCE_MS = 1300 // pause that ends a sentence
const NO_SPEECH_MS = 7000 // gave up waiting for him to start
const MAX_MS = 28000 // Sarvam's sync limit is 30s per clip
// Peak RMS (0..1, raw mic, auto-gain off) the speech must reach. Measured
// levels vary a lot by laptop and mic, so these are deliberately lenient;
// Settings has a live mic check to pick one. (The first version used 0.03-0.08
// and dropped normal speech on a MacBook.)
export const GATE_LEVEL: Record<VoiceGate, number> = { off: 0, low: 0.008, medium: 0.015, high: 0.03 }
const MIN_CONFIDENCE = 0.2
const FILLERS = new Set(['hmm', 'hm', 'hmmm', 'mm', 'mmm', 'uh', 'uhh', 'um', 'umm', 'ah', 'huh', 'er'])

export function isFiller(text: string) {
  const t = text.toLowerCase().replace(/[^\p{L}\p{M}\p{N} ]/gu, '').trim()
  return t.length < 2 || FILLERS.has(t)
}

// Live mic level for the waveform ring, plus the loudest moment of a listen.
export function createMeter(stream: MediaStream, levelRef: { current: number }) {
  const ctx = new AudioContext()
  ctx.resume().catch(() => {})
  let signal = false // any non-silent sample at all: false = meter not working
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 1024
  ctx.createMediaStreamSource(stream).connect(analyser)
  const buf = new Uint8Array(analyser.fftSize)
  let peak = 0
  let raf = 0
  const read = () => {
    analyser.getByteTimeDomainData(buf)
    let sum = 0
    for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v }
    const rms = Math.sqrt(sum / buf.length)
    if (rms > 0.0005) signal = true
    return rms
  }
  const loop = () => { const r = read(); peak = Math.max(peak, r); levelRef.current = r; raf = requestAnimationFrame(loop) }
  raf = requestAnimationFrame(loop)
  return {
    read,
    peak: () => peak,
    // A suspended AudioContext or a muted second stream reads pure silence;
    // then the loudness filter must not be applied at all.
    working: () => ctx.state === 'running' && signal,
    stop: () => { cancelAnimationFrame(raf); levelRef.current = 0; stream.getTracks().forEach((t) => t.stop()); ctx.close().catch(() => {}) },
  }
}

const MIC = { echoCancellation: true, noiseSuppression: true, autoGainControl: false }

// One speech recogniser per page at a time. The "Hey DB" listener runs whenever
// DB is idle (panel open or closed); anything else that needs the mic -- her
// listening, the "stop" listener, the name trainer -- first takes it from the
// wake listener and marks it busy, and the wake listener waits until it is free.
const mic = { wake: null as any, busy: 0, since: 0 }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function takeMic() {
  mic.busy++
  mic.since = Date.now()
  if (mic.wake) { try { mic.wake.abort() } catch {} mic.wake = null; await sleep(250) }
}
function releaseMic() { mic.busy = Math.max(0, mic.busy - 1) }

// Short fixed lines ("Yes Boss?") are fetched once and replayed instantly.
const audioCache = new Map<string, string>()

export function useVoice(config: VoiceConfig, onFinal: Final, onNothingHeard?: (why: NothingReason, dropped?: Dropped) => void) {
  const [listening, setListening] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [interim, setInterim] = useState('')
  const [speaking, setSpeaking] = useState(false)
  const [micError, setMicError] = useState<string | null>(null)
  const finalRef = useRef(onFinal)
  finalRef.current = onFinal
  const nothingRef = useRef(onNothingHeard)
  nothingRef.current = onNothingHeard
  const cfgRef = useRef(config)
  cfgRef.current = config
  const stopRef = useRef<(() => void) | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const speakDone = useRef<(() => void) | null>(null)
  const levelRef = useRef(0)
  // Set by cancel(): the listen in progress ends without sending anything.
  const cancelledRef = useRef(false)

  const browserRecognitionCtor = () =>
    typeof window === 'undefined' ? null : (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
  const supported = typeof window !== 'undefined' && (
    config.listen === 'sarvam' ? !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined' : !!browserRecognitionCtor()
  )

  const stopSpeaking = useCallback(() => {
    audioRef.current?.pause()
    audioRef.current = null
    window.speechSynthesis?.cancel()
    setSpeaking(false)
    speakDone.current?.()
    speakDone.current = null
  }, [])

  // ---------------------------------------------------------------- listen
  const listenSarvam = useCallback(async () => {
    setMicError(null)
    await takeMic()
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: MIC })
    } catch {
      releaseMic()
      setMicError('Microphone permission is blocked. Allow it in the browser’s site settings.')
      nothingRef.current?.('error')
      return
    }
    const gate = Math.max(GATE_LEVEL[cfgRef.current.gate || 'medium'], 0.006)
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((m) => MediaRecorder.isTypeSupported(m)) || ''
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
    const chunks: Blob[] = []
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data)
    const meter = createMeter(stream, levelRef)
    const started = Date.now()
    let heard = false
    let lastVoice = Date.now()
    let timer = 0
    let done = false

    const finish = () => {
      if (done) return
      done = true
      clearInterval(timer)
      if (recorder.state !== 'inactive') recorder.stop()
    }
    stopRef.current = finish
    timer = window.setInterval(() => {
      const now = Date.now()
      if (meter.read() > gate || (!meter.working() && now - started > 300)) { heard = true; lastVoice = now }
      if ((heard && now - lastVoice > SILENCE_MS) || (!heard && now - started > NO_SPEECH_MS) || now - started > MAX_MS) finish()
    }, 50)

    recorder.onstop = async () => {
      meter.stop()
      releaseMic()
      setListening(false)
      stopRef.current = null
      if (cancelledRef.current) return
      if (!heard || chunks.length === 0) { nothingRef.current?.('silence'); return }
      const seconds = Math.round((Date.now() - started) / 1000)
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
      setTranscribing(true)
      try {
        const form = new FormData()
        form.append('audio', blob, blob.type.includes('mp4') ? 'speech.m4a' : 'speech.webm')
        form.append('seconds', String(seconds))
        const res = await apiFetch('/api/assistant/transcribe', { method: 'POST', body: form, timeoutMs: 40_000 })
        const j = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(j.error || 'Could not understand that.')
        if (cancelledRef.current) return
        if (!j.text) nothingRef.current?.('silence')
        else if (isFiller(j.text)) nothingRef.current?.('ignored', { text: j.text, reason: 'filler', peak: meter.peak(), confidence: 1 })
        else finalRef.current(j.text, j.language ?? null)
      } catch (err) {
        setMicError((err as Error).message)
        nothingRef.current?.('error')
      } finally {
        setTranscribing(false)
      }
    }

    recorder.start(250)
    setListening(true)
  }, [])

  const listenBrowser = useCallback(async () => {
    const Ctor = browserRecognitionCtor()
    if (!Ctor) return
    setMicError(null)
    await takeMic()
    // A second, raw-level stream only to measure loudness; recognition still
    // works if it can't be opened.
    let meter: ReturnType<typeof createMeter> | null = null
    try { meter = createMeter(await navigator.mediaDevices.getUserMedia({ audio: MIC }), levelRef) } catch { /* meter is optional */ }
    const gate = GATE_LEVEL[cfgRef.current.gate || 'medium']
    const rec = new Ctor()
    rec.lang = 'en-IN'
    rec.interimResults = true
    rec.continuous = false
    let final = ''
    const confidences: number[] = []
    let error: string | null = null
    rec.onresult = (e: any) => {
      let live = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) { final += e.results[i][0].transcript + ' '; confidences.push(Number(e.results[i][0].confidence) || 0) }
        else live += e.results[i][0].transcript
      }
      setInterim((final + live).trim())
    }
    rec.onerror = (e: any) => {
      error = e.error
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') setMicError('Microphone permission is blocked. Allow it in the browser’s site settings.')
    }
    rec.onend = () => {
      releaseMic()
      const measured = !!meter && meter.working()
      const peak = measured ? meter!.peak() : 1
      meter?.stop()
      setListening(false)
      setInterim('')
      stopRef.current = null
      if (cancelledRef.current) return
      const text = final.trim()
      if (!text) { nothingRef.current?.(error && error !== 'no-speech' && error !== 'aborted' ? 'error' : 'silence'); return }
      const scored = confidences.filter((c) => c > 0)
      const confidence = scored.length ? scored.reduce((a, c) => a + c, 0) / scored.length : 1
      const reason = isFiller(text) ? 'filler' : (gate > 0 && peak < gate) ? 'too_quiet' : confidence < MIN_CONFIDENCE ? 'unsure' : null
      // eslint-disable-next-line no-console
      console.info(`[DB] heard "${text}" peak=${measured ? peak.toFixed(3) : 'n/a'} gate=${gate} confidence=${confidence.toFixed(2)} -> ${reason || 'sent'}`)
      if (reason) { nothingRef.current?.('ignored', { text, reason, peak, confidence }); return }
      finalRef.current(text, null)
    }
    stopRef.current = () => { try { rec.stop() } catch {} }
    try { rec.start() } catch {
      releaseMic()
      meter?.stop(); stopRef.current = null
      setMicError('The microphone is busy. Try the mic button again.')
      nothingRef.current?.('error')
      return
    }
    setListening(true)
  }, [])

  const start = useCallback(() => {
    cancelledRef.current = false
    stopSpeaking()
    if (cfgRef.current.listen === 'sarvam') listenSarvam()
    else listenBrowser()
  }, [listenSarvam, listenBrowser, stopSpeaking])

  const stop = useCallback(() => stopRef.current?.(), [])
  const cancel = useCallback(() => { cancelledRef.current = true; stopRef.current?.() }, [])

  // ---------------------------------------------------------------- speak
  const speakBrowser = useCallback((text: string, onEnd: () => void) => {
    const synth = window.speechSynthesis
    if (!synth) { onEnd(); return }
    synth.cancel()
    const u = new SpeechSynthesisUtterance(text.replace(/[*_#`]/g, ''))
    const voices = synth.getVoices()
    u.voice = voices.find((v) => v.lang === 'en-IN') || voices.find((v) => v.lang === 'hi-IN') || null
    u.lang = u.voice?.lang || 'en-IN'
    u.onend = onEnd
    u.onerror = onEnd
    synth.speak(u)
  }, [])

  // Resolves when she has finished speaking (or was interrupted), so a
  // conversation can start listening again right after.
  const speak = useCallback((text: string, preview?: VoicePreview, cache = false) => new Promise<void>((resolve) => {
    if (!text.trim() || (!cfgRef.current.speakReplies && !preview)) { resolve(); return }
    stopSpeaking()
    setSpeaking(true)
    const end = () => { setSpeaking(false); speakDone.current = null; resolve() }
    speakDone.current = end
    const provider = preview?.provider || cfgRef.current.speak
    if (provider === 'browser') { speakBrowser(text, end); return }
    const key = `${provider}|${text}`
    const cached = cache ? audioCache.get(key) : undefined
    ;(cached ? Promise.resolve({ ok: true, json: async () => ({ audio: cached }) } as unknown as Response) : apiFetch('/api/assistant/speak', { method: 'POST', body: JSON.stringify({ text, ...(preview || {}) }), timeoutMs: 40_000 }))
      .then(async (res) => {
        const j = await res.json()
        if (!res.ok || !j.audio) throw new Error(j.error || 'no audio')
        if (cache) audioCache.set(key, j.audio)
        if (speakDone.current !== end) return // interrupted meanwhile
        const audio = new Audio(`data:audio/mpeg;base64,${j.audio}`)
        audioRef.current = audio
        audio.onended = end
        audio.onerror = end
        await audio.play()
      })
      .catch(() => { if (speakDone.current === end) speakBrowser(text, end) })
  }), [speakBrowser, stopSpeaking])

  useEffect(() => () => { cancelledRef.current = true; stopRef.current?.(); stopSpeaking() }, [stopSpeaking])

  return { supported, listening, transcribing, interim, speaking, micError, levelRef, start, stop, cancel, speak, stopSpeaking }
}

// ------------------------------------------------------------------ wake word
//
// "Hey DB" / "DB, suno": a light always-on listener using the browser's free
// recogniser, only while the ERP tab is visible and the feature is switched on in
// Settings. Pauses whenever the DB panel is open or she is busy.
//
// Safety rules (a runaway listener once looped until Chrome closed):
//   - exactly ONE recogniser at a time: a new one only starts after the old one
//     has fully ended, and returning to the tab never starts a second one;
//   - stops while the tab is hidden, and while the DB panel is open (the panel
//     uses the mic itself; two recognisers on one page cancel each other);
//   - a session that ends quickly or with an error backs off 1s, 2s, 4s ... 30s,
//     and after 6 failures in a row it gives up until the page is reloaded.
//
// "DB" is a hard word for recognisers (heard as IDBI, TP, TV, the bee...), so it
// checks the recogniser's top 5 guesses, a long list of known mishearings, and
// the phrases the owner taught it in Settings ("Teach DB her name").
export const NAME_VARIANTS = [
  'db', 'd b', 'dee bee', 'deebee', 'dbi', 'idbi', 'i d b i', 'debi', 'debbie', 'debby', 'deby', 'dibi', 'divi', 'deepi', 'deepu', 'dipi',
  'tp', 't p', 'tb', 't b', 'dp', 'd p', 'tv', 'pb', 'bb', 'vb', 'the bee', 'the b', 'thee bee', 'deeby',
  'डीबी', 'डी बी', 'टीपी', 'दीबी', 'डेबी',
]
const FATAL_ERRORS = new Set(['not-allowed', 'service-not-allowed', 'language-not-supported'])
const MAX_FAILURES = 6
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{M}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim()
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const NAME_RE = new RegExp(`(?:^| )(?:hey|hay|he|hei|a|ay|ae|hi|hii|hai|hello|helo|ok|okay|o|suno|are|arre|हाय|हे|हेलो|हैलो|ओके|सुनो|अरे) (?:${NAME_VARIANTS.map(escapeRe).join('|')})(?: |$)|(?:^| )(?:${NAME_VARIANTS.map(escapeRe).join('|')}) (?:suno|सुनो)(?: |$)`)

// "Hey DB" run together into one word by the recogniser.
const JOINED = ['hdb', 'heydb', 'hidb', 'hedb', 'haydb', 'hellodb', 'okdb', 'hitp', 'heytp', 'hiidb']

export function wakeMatches(heard: string, phrases: string[]) {
  const h = ` ${norm(heard)} `
  if (JOINED.some((j) => h.includes(` ${j} `))) return true
  if (phrases.map(norm).filter(Boolean).some((p) => h.includes(` ${p} `))) return true
  return NAME_RE.test(h.trim())
}

export function useWakeWord(enabled: boolean, phrases: string[], paused: boolean, onWake: () => void) {
  const wakeRef = useRef(onWake)
  wakeRef.current = onWake
  const [active, setActive] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const failedRef = useRef(false)

  useEffect(() => {
    const Ctor = typeof window === 'undefined' ? null : (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!enabled || paused || !Ctor || failedRef.current) { setActive(false); return }
    let disposed = false
    let rec: any = null // the one live recogniser, null once it has ended
    let timer: ReturnType<typeof setTimeout> | null = null
    let failures = 0
    const giveUp = (why: string) => {
      disposed = true
      failedRef.current = true
      setFailed(why)
      setActive(false)
    }
    const schedule = (ms: number) => {
      if (disposed || timer) return
      timer = setTimeout(() => { timer = null; begin() }, ms)
    }
    const begin = () => {
      if (disposed || rec || document.visibilityState !== 'visible') return
      if (mic.busy > 0 && Date.now() - mic.since > 90_000) mic.busy = 0 // a holder that never let go; no listen lasts 90s
      if (mic.busy > 0) { schedule(800); return } // DB is using the mic; try again shortly (not a failure)
      const r = new Ctor()
      r.lang = 'en-IN'
      r.continuous = true
      r.interimResults = true
      r.maxAlternatives = 5
      const startedAt = Date.now()
      let errored = false
      let woke = false
      r.onresult = (e: any) => {
        failures = 0
        for (let i = e.resultIndex; i < e.results.length; i++) {
          for (let a = 0; a < e.results[i].length; a++) {
            if (wakeMatches(e.results[i][a].transcript, phrases)) {
              // eslint-disable-next-line no-console
              console.info(`[DB wake] woke on "${e.results[i][a].transcript}"`)
              woke = true; try { r.abort() } catch {} return
            }
          }
          if (e.results[i].isFinal) {
            // eslint-disable-next-line no-console
            console.info(`[DB wake] heard "${e.results[i][0].transcript}" (not a wake phrase)`)
          }
        }
      }
      r.onerror = (e: any) => {
        if (e.error === 'aborted' || e.error === 'no-speech') return
        errored = true
        if (FATAL_ERRORS.has(e.error)) giveUp(e.error === 'not-allowed' ? 'Microphone permission is blocked.' : `Speech recognition unavailable (${e.error}).`)
      }
      r.onend = () => {
        if (rec === r) rec = null
        if (mic.wake === r) mic.wake = null
        setActive(false)
        if (woke) { wakeRef.current(); return } // the panel opens and pauses this hook
        if (disposed) return
        if (mic.busy > 0) { schedule(800); return } // taken by DB's own listening, not an error
        if (errored || Date.now() - startedAt < 3000) {
          failures++
          if (failures >= MAX_FAILURES) { giveUp('“Hey DB” stopped after repeated errors. Reload the page to try again.'); return }
          schedule(Math.min(30_000, 1000 * 2 ** (failures - 1)))
        } else {
          schedule(500) // Chrome ends long sessions on its own; just carry on
        }
      }
      rec = r
      try { r.start(); mic.wake = r; setActive(true) } catch { rec = null; failures++; schedule(2000) }
    }
    const onVis = () => {
      if (document.visibilityState === 'visible') schedule(300)
      else { if (timer) { clearTimeout(timer); timer = null } try { rec?.abort() } catch {} }
    }
    document.addEventListener('visibilitychange', onVis)
    begin()
    return () => {
      disposed = true
      document.removeEventListener('visibilitychange', onVis)
      if (timer) clearTimeout(timer)
      try { rec?.abort() } catch {}
      if (mic.wake === rec) mic.wake = null
      setActive(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, paused, phrases.join('|')])

  return { active, failed }
}

// ------------------------------------------------------------------ name trainer
//
// Settings -> "Teach DB her name": listens to one "Hi DB" and returns every way
// the recogniser spelled it (top 5 guesses), so those spellings can be saved as
// wake phrases. Free (browser recogniser), one short listen per tap.
export function useNameTrainer() {
  const [listening, setListening] = useState(false)
  const [heard, setHeard] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const listen = useCallback(() => {
    const Ctor = typeof window === 'undefined' ? null : (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!Ctor) { setError('This browser has no speech recognition. Use Chrome.'); return }
    setError(null)
    window.dispatchEvent(new CustomEvent('db-wake-pause', { detail: true }))
    // Take the mic from the wake listener first.
    takeMic().then(() => {
      const r = new Ctor()
      r.lang = 'en-IN'
      r.continuous = false
      r.interimResults = false
      r.maxAlternatives = 5
      const got: string[] = []
      r.onresult = (e: any) => {
        for (let i = 0; i < e.results.length; i++) for (let a = 0; a < e.results[i].length; a++) got.push(norm(e.results[i][a].transcript))
      }
      r.onerror = (e: any) => { if (e.error !== 'no-speech' && e.error !== 'aborted') setError(`Could not listen (${e.error}).`) }
      r.onend = () => {
        releaseMic()
        setListening(false)
        window.dispatchEvent(new CustomEvent('db-wake-pause', { detail: false }))
        const fresh = got.filter((g) => g && g.split(' ').length <= 4)
        if (!fresh.length) setError((x) => x || 'Didn’t hear anything. Tap and say “Hi DB” clearly.')
        setHeard((prev) => [...new Set([...prev, ...fresh])])
      }
      try { r.start(); setListening(true) } catch { releaseMic(); setError('Microphone busy, try again.'); window.dispatchEvent(new CustomEvent('db-wake-pause', { detail: false })) }
    })
  }, [])
  return { listening, heard, error, listen, clear: () => setHeard([]) }
}

// ------------------------------------------------------------------ "stop!"
//
// While DB is speaking, a short-lived browser recogniser listens only for
// "stop / ruko / bas / pata hai…" and cuts her off at once (interim results,
// so it reacts mid-word). It runs only while she speaks -- the panel's own
// listening and the wake word are both idle then, so it never competes with
// another recogniser. Her own voice coming back through the speakers is
// filtered two ways: a "strong" word counts only if it isn't in what she is
// saying, and a "weak" word ("bas", "ok ok") only when it is said on its own.
const STRONG_STOP = ['stop', 'stop it', 'ruko', 'ruk jao', 'ruk ja', 'chup', 'chup karo', 'enough', 'rehne do', 'skip', 'band karo', 'leave it', 'hold on',
  'स्टॉप', 'रुको', 'रुक जाओ', 'चुप', 'बस करो', 'रहने दो', 'बंद करो']
const WEAK_STOP = ['bas', 'bas bas', 'bas karo', 'ok ok', 'okay okay', 'theek hai theek hai', 'pata hai', 'mujhe pata hai', 'samajh gaya', 'samajh gayi', 'got it', 'haan haan', 'next',
  'बस', 'बस बस', 'पता है', 'समझ गया', 'हाँ हाँ']
const hasPhrase = (hay: string, p: string) => ` ${hay} `.includes(` ${p} `)

export function stopHeard(heard: string, saying: string) {
  const h = norm(heard)
  if (!h) return false
  const said = norm(saying)
  const short = h.split(' ').length <= 3
  // A stop word on its own is always him; inside a longer phrase it counts
  // only if she isn't saying that word herself (her echo).
  if (STRONG_STOP.some((p) => hasPhrase(h, p) && (short || !hasPhrase(said, p)))) return true
  return short && WEAK_STOP.some((p) => hasPhrase(h, p) && (h === p || !hasPhrase(said, p)))
}

export function useStopWords(active: boolean, saying: string, onStop: () => void) {
  const stopRef = useRef(onStop)
  stopRef.current = onStop
  const sayingRef = useRef(saying)
  sayingRef.current = saying
  useEffect(() => {
    const Ctor = typeof window === 'undefined' ? null : (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!active || !Ctor) return
    let rec: any = null
    let done = false
    let restarts = 0
    let holding = false
    const begin = async () => {
      if (done || restarts > 3) return
      if (!holding) { holding = true; await takeMic(); if (done) { holding = false; releaseMic(); return } }
      const r = new Ctor()
      r.lang = 'en-IN'
      r.continuous = true
      r.interimResults = true
      r.maxAlternatives = 3
      r.onresult = (e: any) => {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          for (let a = 0; a < e.results[i].length; a++) {
            if (stopHeard(e.results[i][a].transcript, sayingRef.current)) {
              done = true
              try { r.abort() } catch {}
              stopRef.current()
              return
            }
          }
        }
      }
      // Chrome ends a session on its own after a while; carry on while she is
      // still speaking, but never more than a few times (no loops).
      r.onend = () => { if (rec === r) rec = null; if (!done) { restarts++; setTimeout(begin, 200) } }
      rec = r
      try { r.start() } catch { rec = null }
    }
    const t = setTimeout(begin, 250)
    return () => { done = true; clearTimeout(t); try { rec?.abort() } catch {} if (holding) { holding = false; releaseMic() } }
  }, [active])
}
