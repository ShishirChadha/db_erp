'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch } from '@/lib/api-client'
import { NAME_VARIANTS } from './names'

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
export type ListenProvider = 'sarvam' | 'azure' | 'browser'
export type VoiceGate = 'off' | 'low' | 'medium' | 'high'
export interface VoiceConfig {
  listen: ListenProvider
  speak: SpeakProvider
  speakReplies: boolean
  gate?: VoiceGate
}
export interface VoicePreview { provider: SpeakProvider; voice: string; pace: number }
export type NothingReason = 'silence' | 'ignored' | 'error'
// What was dropped and why, so the panel can show it and offer "send it".
export interface Dropped { text: string; reason: 'too_quiet' | 'unsure' | 'filler'; peak: number; confidence: number }

type Final = (text: string, language: string | null) => void
// 'blocked': the browser held her voice until a tap that never came;
// 'failed': this device couldn't play it at all.
export type SpeakIssue = 'blocked' | 'failed' | null

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

// Android: opening the microphone (Google's speech service) takes the phone's
// audio focus and pauses/mutes whatever the page is playing. So on Android no
// recogniser may run while DB speaks (no "say stop" listener -- tap instead),
// and her voice is not routed through Web Audio for the level meter.
export const isAndroid = () => typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)
// iPhone / iPad (iPadOS reports itself as a Mac with touch).
export const isIOS = () => typeof navigator !== 'undefined' && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))
// Phones share the same audio rules: an open mic ducks/mutes playback (iPhone
// even routes it to the earpiece), and audio through Web Audio obeys the
// iPhone's silent switch. So on phones: no mic while she speaks, no Web Audio
// routing of her voice, no second mic stream.
export const isPhoneAudio = () => isAndroid() || isIOS()

// Chrome blocks sound until the page has been tapped once (e.g. she was woken
// by "Hey DB" on a page you haven't touched). The panel listens for this and
// shows "Tap to hear DB".
export const AUDIO_BLOCKED_EVENT = 'db-audio-blocked'

// The browser's own speech recognition, where it really works. Android WebView
// browsers (DuckDuckGo, in-app browsers) either hide it or expose one that never
// returns anything -- DB then "listened" forever. There, and once a listen has
// proved broken, DB records the audio itself and sends it to Azure instead.
export const BROWSER_SPEECH_BROKEN_EVENT = 'db-browser-speech-broken'
let browserSpeechBroken = false
export function browserSpeechReliable() {
  if (typeof window === 'undefined' || browserSpeechBroken) return false
  if (!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)) return false
  return !/DuckDuckGo|; wv\)|FBAN|FBAV|Instagram|Line\//i.test(navigator.userAgent)
}
function markBrowserSpeechBroken() {
  browserSpeechBroken = true
  window.dispatchEvent(new Event(BROWSER_SPEECH_BROKEN_EVENT))
}

// 16 kHz mono 16-bit WAV from recorded float samples (what Azure expects).
export function encodeWav(chunks: Float32Array[], rate: number) {
  const total = chunks.reduce((a, c) => a + c.length, 0)
  const all = new Float32Array(total)
  let o = 0
  for (const c of chunks) { all.set(c, o); o += c.length }
  const ratio = rate / 16000
  const n = Math.floor(total / ratio)
  const pcm = new Int16Array(n)
  for (let i = 0; i < n; i++) {
    // average the source samples that fall into this output sample
    const start = Math.floor(i * ratio), end = Math.min(total, Math.floor((i + 1) * ratio))
    let sum = 0
    for (let j = start; j < end; j++) sum += all[j]
    const v = Math.max(-1, Math.min(1, sum / Math.max(1, end - start)))
    pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff
  }
  const buf = new ArrayBuffer(44 + pcm.length * 2)
  const dv = new DataView(buf)
  const str = (off: number, t: string) => { for (let i = 0; i < t.length; i++) dv.setUint8(off + i, t.charCodeAt(i)) }
  str(0, 'RIFF'); dv.setUint32(4, 36 + pcm.length * 2, true); str(8, 'WAVE'); str(12, 'fmt ')
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, 16000, true)
  dv.setUint32(28, 32000, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); str(36, 'data'); dv.setUint32(40, pcm.length * 2, true)
  new Int16Array(buf, 44).set(pcm)
  return new Blob([buf], { type: 'audio/wav' })
}

// One audio player for all of her speech, unlocked by your first tap. Android
// WebView browsers (DuckDuckGo) only allow sound from a play started inside a
// tap -- and her replies arrive seconds after you speak -- but an <audio>
// element that has played once inside a tap stays allowed. So: unlock it on the
// first tap anywhere, then reuse it for every reply.
let player: HTMLAudioElement | null = null
let playerUnlocked = false
let unlocking = false
let playerAnalyser: AnalyserNode | null = null
let playToken: object | null = null // the reply currently playing (stops old meter loops)
const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA='
function getPlayer() {
  if (!player && typeof Audio !== 'undefined') player = new Audio()
  return player
}
export function unlockAudio() {
  if (playerUnlocked || unlocking) return
  unlocking = true
  const p = getPlayer()
  if (!p) return
  p.src = SILENT_WAV
  p.play().then(() => { playerUnlocked = true }).catch(() => {}).finally(() => { unlocking = false })
  try { if (sharedCtx?.state === 'suspended') sharedCtx.resume() } catch {}
}
if (typeof window !== 'undefined') {
  // Safari counts only a completed tap (touchend / click) as permission to
  // play, Chrome also the press itself -- listen to all of them.
  const onFirstTap = () => { unlockAudio() }
  for (const ev of ['pointerdown', 'touchend', 'click', 'keydown']) window.addEventListener(ev, onFirstTap, true)
  // iPhone (Safari 16.4+): treat her voice as media playback, so the silent
  // switch doesn't mute it.
  try { const session = (navigator as any).audioSession; if (session) session.type = 'playback' } catch { /* older Safari */ }
}
// Shown in the panel when this browser can't play her voice at all.
export const VOICE_UNAVAILABLE_EVENT = 'db-voice-unavailable'

// Short fixed lines ("Yes Boss?") are fetched once and replayed instantly.
const audioCache = new Map<string, string>()

// One shared audio engine for chimes and for measuring her voice level.
let sharedCtx: AudioContext | null = null
function audioCtx(): AudioContext | null {
  try {
    if (!sharedCtx) sharedCtx = new AudioContext()
    if (sharedCtx.state === 'suspended') sharedCtx.resume().catch(() => {})
    return sharedCtx
  } catch { return null }
}

// Soft earcons (generated, no sound files): rising two notes when she starts
// listening, one falling note when she has heard you.
export function chime(kind: 'listen' | 'heard' | 'wake') {
  const ctx = audioCtx()
  if (!ctx || ctx.state !== 'running') return
  const notes = kind === 'listen' ? [660, 880] : kind === 'wake' ? [523, 784, 1047] : [740, 494]
  const t0 = ctx.currentTime
  notes.forEach((f, i) => {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = f
    const start = t0 + i * 0.09
    gain.gain.setValueAtTime(0, start)
    gain.gain.linearRampToValueAtTime(0.06, start + 0.015)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16)
    osc.connect(gain).connect(ctx.destination)
    osc.start(start)
    osc.stop(start + 0.18)
  })
}

// A short vibration on Android (Samsung supports it; iPhone ignores it).
export function buzz(pattern: number | number[]) {
  try { navigator.vibrate?.(pattern) } catch { /* not supported */ }
}

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
  const fakeLevelStop = useRef<(() => void) | null>(null)
  // Set by cancel(): the listen in progress ends without sending anything.
  const cancelledRef = useRef(false)
  // Why her last line wasn't heard on this device (null = it played). The
  // panel sends it with the next message, so DB can say so instead of
  // guessing ("I'm only replying in text").
  const speakIssue = useRef<SpeakIssue>(null)
  const takeSpeakIssue = useCallback(() => { const i = speakIssue.current; speakIssue.current = null; return i }, [])

  const browserRecognitionCtor = () =>
    typeof window === 'undefined' ? null : (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
  const supported = typeof window !== 'undefined' && (
    config.listen === 'sarvam' ? !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined'
      : config.listen === 'azure' ? !!navigator.mediaDevices?.getUserMedia && typeof AudioContext !== 'undefined'
      : !!browserRecognitionCtor()
  )

  const stopSpeaking = useCallback(() => {
    audioRef.current?.pause()
    audioRef.current = null
    if (fakeLevelStop.current) fakeLevelStop.current()
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

  // Records your voice itself (16 kHz WAV), stops when you pause, and sends it
  // to Azure speech-to-text. Works in any browser with a microphone.
  const listenAzure = useCallback(async () => {
    setMicError(null)
    await takeMic()
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: MIC })
    } catch {
      releaseMic()
      setMicError('Microphone permission is blocked. Allow it for this site in the browser’s settings.')
      nothingRef.current?.('error')
      return
    }
    const ctx = audioCtx()
    if (!ctx) { stream.getTracks().forEach((t) => t.stop()); releaseMic(); setMicError('This browser can’t record audio.'); nothingRef.current?.('error'); return }
    if (ctx.state !== 'running') await ctx.resume().catch(() => {})
    const gate = Math.max(GATE_LEVEL[cfgRef.current.gate || 'medium'], 0.006)
    const source = ctx.createMediaStreamSource(stream)
    const proc = ctx.createScriptProcessor(4096, 1, 1)
    const chunks: Float32Array[] = []
    const started = Date.now()
    let heard = false
    let lastVoice = Date.now()
    let done = false

    const finish = async () => {
      if (done) return
      done = true
      proc.onaudioprocess = null
      try { proc.disconnect(); source.disconnect() } catch {}
      stream.getTracks().forEach((t) => t.stop())
      levelRef.current = 0
      releaseMic()
      setListening(false)
      stopRef.current = null
      if (cancelledRef.current) return
      if (!heard || !chunks.length) { nothingRef.current?.('silence'); return }
      const seconds = Math.max(1, Math.round((Date.now() - started) / 1000))
      setTranscribing(true)
      try {
        const form = new FormData()
        form.append('audio', encodeWav(chunks, ctx.sampleRate), 'speech.wav')
        form.append('seconds', String(seconds))
        form.append('provider', 'azure')
        const res = await apiFetch('/api/assistant/transcribe', { method: 'POST', body: form, timeoutMs: 40_000 })
        const j = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(j.error || 'Could not understand that.')
        if (cancelledRef.current) return
        if (!j.text) nothingRef.current?.('silence')
        else if (isFiller(j.text)) nothingRef.current?.('ignored', { text: j.text, reason: 'filler', peak: 1, confidence: 1 })
        else finalRef.current(j.text, j.language ?? null)
      } catch (err) {
        setMicError((err as Error).message)
        nothingRef.current?.('error')
      } finally {
        setTranscribing(false)
      }
    }
    proc.onaudioprocess = (e) => {
      const data = e.inputBuffer.getChannelData(0)
      chunks.push(new Float32Array(data))
      let sum = 0
      for (let i = 0; i < data.length; i++) sum += data[i] * data[i]
      const rms = Math.sqrt(sum / data.length)
      levelRef.current = rms
      const now = Date.now()
      if (rms > gate) { heard = true; lastVoice = now }
      if ((heard && now - lastVoice > SILENCE_MS) || (!heard && now - started > NO_SPEECH_MS) || now - started > 55_000) finish()
    }
    source.connect(proc)
    proc.connect(ctx.destination) // a ScriptProcessor only runs when connected; it outputs silence
    stopRef.current = finish
    setListening(true)
  }, [])

  const listenBrowser = useCallback(async () => {
    const Ctor = browserRecognitionCtor()
    if (!Ctor) return
    setMicError(null)
    await takeMic()
    // A second, raw-level stream only to measure loudness; recognition still
    // works if it can't be opened.
    // (Not on Android: a second mic stream can stop Google's recogniser from
    // getting the mic, and Android already filters background noise itself.)
    let meter: ReturnType<typeof createMeter> | null = null
    if (!isPhoneAudio()) { try { meter = createMeter(await navigator.mediaDevices.getUserMedia({ audio: MIC }), levelRef) } catch { /* meter is optional */ } }
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
    // Watchdog: some browsers start "listening" and never deliver anything or
    // end. No audio within 5 s = broken (switch to Azure); and no listen may
    // run longer than 25 s, whatever the browser does.
    let gotAudio = false
    let ended = false
    rec.onaudiostart = () => { gotAudio = true }
    rec.onsoundstart = () => { gotAudio = true }
    const forceEnd = (broken: boolean) => {
      if (ended) return
      if (broken) markBrowserSpeechBroken()
      try { rec.abort() } catch {}
      // If the browser doesn't even fire onend after abort, end it ourselves.
      setTimeout(() => { if (!ended) rec.onend?.() }, 1200)
    }
    const noAudioTimer = setTimeout(() => { if (!gotAudio) forceEnd(true) }, 5000)
    const maxTimer = setTimeout(() => forceEnd(false), 25_000)
    rec.onend = () => {
      if (ended) return
      ended = true
      clearTimeout(noAudioTimer)
      clearTimeout(maxTimer)
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
    const how = cfgRef.current.listen
    if (how === 'azure') { audioCtx(); listenAzure() } // create the audio engine inside the tap
    else if (how === 'sarvam') listenSarvam()
    else listenBrowser()
  }, [listenSarvam, listenAzure, listenBrowser, stopSpeaking])

  const stop = useCallback(() => stopRef.current?.(), [])
  const cancel = useCallback(() => { cancelledRef.current = true; stopRef.current?.() }, [])

  // ---------------------------------------------------------------- speak
  // Browser speech can't be measured, so give the avatar a gentle fake level.
  const fakeLevel = useRef<ReturnType<typeof setInterval> | null>(null)
  const startFakeLevel = () => {
    if (fakeLevel.current) clearInterval(fakeLevel.current)
    fakeLevel.current = setInterval(() => { levelRef.current = 0.02 + Math.random() * 0.06 }, 110)
  }
  const stopLevel = () => { if (fakeLevel.current) { clearInterval(fakeLevel.current); fakeLevel.current = null } levelRef.current = 0 }
  fakeLevelStop.current = stopLevel

  const speakBrowser = useCallback((text: string, onEnd: () => void) => {
    const synth = window.speechSynthesis
    // Android WebView browsers have no built-in voices: say so instead of silence.
    if (!synth || (typeof synth.getVoices === 'function' && synth.getVoices().length === 0 && isAndroid())) {
      speakIssue.current = 'failed'
      window.dispatchEvent(new Event(VOICE_UNAVAILABLE_EVENT))
      onEnd()
      return
    }
    startFakeLevel()
    synth.cancel()
    const u = new SpeechSynthesisUtterance(text.replace(/[*_#`]/g, ''))
    const voices = synth.getVoices()
    u.voice = voices.find((v) => v.lang === 'en-IN') || voices.find((v) => v.lang === 'hi-IN') || null
    u.lang = u.voice?.lang || 'en-IN'
    u.onend = onEnd
    u.onerror = (e: SpeechSynthesisErrorEvent) => {
      if (e.error !== 'interrupted' && e.error !== 'canceled') speakIssue.current = 'failed'
      onEnd()
    }
    synth.speak(u)
  }, [])

  // Resolves when she has finished speaking (or was interrupted), so a
  // conversation can start listening again right after.
  const speak = useCallback((text: string, preview?: VoicePreview, cache = false) => new Promise<void>((resolve) => {
    if (!text.trim() || (!cfgRef.current.speakReplies && !preview)) { resolve(); return }
    stopSpeaking()
    setSpeaking(true)
    speakIssue.current = null
    const end = () => { stopLevel(); setSpeaking(false); speakDone.current = null; resolve() }
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
        const audio = getPlayer() || new Audio()
        audio.src = `data:audio/mpeg;base64,${j.audio}`
        audioRef.current = audio
        audio.onended = end
        audio.onerror = () => { speakIssue.current = 'failed'; end() }
        audio.onplaying = () => { speakIssue.current = null } // incl. after "Tap to hear DB"
        // Measure her voice for the avatar -- only when the audio engine is
        // already running; routing audio through a suspended engine would
        // silence her, so then the level is faked instead.
        const ctx = isPhoneAudio() ? null : audioCtx()
        const token = {}
        playToken = token
        if (ctx && ctx.state === 'running') {
          try {
            // The shared player can be wired to the meter only once; reuse it.
            if (!playerAnalyser || playerAnalyser.context !== ctx) {
              playerAnalyser = ctx.createAnalyser()
              playerAnalyser.fftSize = 512
              ctx.createMediaElementSource(audio).connect(playerAnalyser)
              playerAnalyser.connect(ctx.destination)
            }
            const an = playerAnalyser
            const buf = new Uint8Array(an.fftSize)
            const tick = () => {
              if (playToken !== token || audioRef.current !== audio) return
              an.getByteTimeDomainData(buf)
              let sum = 0
              for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v }
              levelRef.current = Math.sqrt(sum / buf.length) * 0.6
              requestAnimationFrame(tick)
            }
            requestAnimationFrame(tick)
          } catch { startFakeLevel() }
        } else startFakeLevel()
        try {
          await audio.play()
        } catch (err) {
          if ((err as Error)?.name === 'NotAllowedError') {
            // Blocked until a tap: keep the audio ready and ask for one tap.
            speakIssue.current = 'blocked'
            window.dispatchEvent(new CustomEvent(AUDIO_BLOCKED_EVENT, { detail: () => audio.play().catch(() => end()) }))
            return
          }
          throw err
        }
      })
      .catch(() => { if (speakDone.current === end) speakBrowser(text, end) })
  }), [speakBrowser, stopSpeaking])

  useEffect(() => () => { cancelledRef.current = true; stopRef.current?.(); stopSpeaking() }, [stopSpeaking])

  return { supported, listening, transcribing, interim, speaking, micError, levelRef, start, stop, cancel, speak, stopSpeaking, takeSpeakIssue }
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
export { NAME_VARIANTS }
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
  // Two-word phrases only: a single word like "idbi" would wake her on "IDBI bank".
  if (phrases.map(norm).filter((p) => p.includes(' ')).some((p) => h.includes(` ${p} `))) return true
  return NAME_RE.test(h.trim())
}

export function useWakeWord(enabled: boolean, phrases: string[], paused: boolean, onWake: () => void) {
  const wakeRef = useRef(onWake)
  wakeRef.current = onWake
  const [active, setActive] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  // Only a blocked microphone stops it for good (until reload); anything else
  // rests a minute and tries again -- it used to give up silently after six
  // errors, which with the panel open looked like "she doesn't wake at all".
  const blockedRef = useRef(false)

  useEffect(() => {
    const Ctor = typeof window === 'undefined' ? null : (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!Ctor || !browserSpeechReliable()) { setFailed('“Hey DB” needs Chrome. In this browser, tap the mic.'); setActive(false); return }
    if (!enabled || paused || blockedRef.current) { setActive(false); return }
    let disposed = false
    let rec: any = null // the one live recogniser, null once it has ended
    let timer: ReturnType<typeof setTimeout> | null = null
    let failures = 0
    // One listening tab across the whole browser: Chrome lets only one page
    // recognise speech at a time, so two ERP tabs would keep cutting each other
    // off. The tab used most recently claims the mic; the others stand down
    // until they are used again.
    const me = Math.random().toString(36).slice(2)
    const bc = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('db-wake') : null
    let standDown = false
    bc && (bc.onmessage = (e: MessageEvent) => {
      if (e.data?.type !== 'claim' || e.data.id === me || disposed) return
      standDown = true
      if (timer) { clearTimeout(timer); timer = null }
      try { rec?.abort() } catch {}
      setActive(false)
      setFailed('“Hey DB” is listening in your other ERP tab. Click here to listen in this one.')
    })
    const claim = () => { standDown = false; setFailed(null); bc?.postMessage({ type: 'claim', id: me }) }
    const giveUp = (why: string) => {
      disposed = true
      blockedRef.current = true
      setFailed(why)
      setActive(false)
    }
    const schedule = (ms: number) => {
      if (disposed || timer) return
      timer = setTimeout(() => { timer = null; begin() }, ms)
    }
    const begin = () => {
      if (disposed || standDown || rec || document.visibilityState !== 'visible') return
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
        // eslint-disable-next-line no-console
        console.warn(`[DB wake] error: ${e.error}`)
        errored = true
        if (FATAL_ERRORS.has(e.error)) giveUp(e.error === 'not-allowed' ? 'Microphone blocked for this site: allow it in Chrome’s site settings, then reload.' : `Speech recognition unavailable (${e.error}).`)
      }
      r.onend = () => {
        if (rec === r) rec = null
        if (mic.wake === r) mic.wake = null
        setActive(false)
        if (woke) { wakeRef.current(); return } // the panel opens and pauses this hook
        if (disposed || standDown) return
        if (mic.busy > 0) { schedule(800); return } // taken by DB's own listening, not an error
        if (errored || Date.now() - startedAt < 3000) {
          failures++
          if (failures >= MAX_FAILURES) {
            failures = 0
            setFailed('“Hey DB” hit errors; trying again in a minute.')
            schedule(60_000)
            return
          }
          schedule(Math.min(30_000, 1000 * 2 ** (failures - 1)))
        } else {
          schedule(500) // Chrome ends long sessions on its own; just carry on
        }
      }
      rec = r
      try {
        r.start(); mic.wake = r; setActive(true); setFailed(null)
        // eslint-disable-next-line no-console
        console.info('[DB wake] listening for the wake phrase')
      } catch { rec = null; failures++; schedule(2000) }
    }
    const onVis = () => {
      if (document.visibilityState === 'visible') { claim(); schedule(300) }
      else { if (timer) { clearTimeout(timer); timer = null } try { rec?.abort() } catch {} }
    }
    const onFocus = () => { if (standDown) { claim(); schedule(300) } }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('focus', onFocus)
    window.addEventListener('pointerdown', onFocus)
    claim()
    begin()
    return () => {
      disposed = true
      bc?.close()
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('pointerdown', onFocus)
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
        const fresh = got.filter((g) => g && g.includes(' ') && g.split(' ').length <= 4)
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

export function useStopWords(activeIn: boolean, saying: string, onStop: () => void) {
  // Never on Android: the open mic would pause her voice (see isAndroid).
  const active = activeIn && !isPhoneAudio()
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
