'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch } from '@/lib/api-client'

// DB's ears and voice in the browser.
//
// provider 'sarvam' (default): the mic is recorded with MediaRecorder, stopped
// automatically when Shishir pauses, and sent to /api/assistant/transcribe
// (Sarvam, Indian English/Hindi/Hinglish). Replies are spoken by
// /api/assistant/speak (a natural Indian female voice). provider 'browser' is the
// free built-in speech, kept as a fallback.

export interface VoiceConfig {
  provider: 'sarvam' | 'browser'
  speakReplies: boolean
}

type Final = (text: string, language: string | null) => void

const SILENCE_MS = 1300 // pause that ends a sentence
const NO_SPEECH_MS = 7000 // gave up waiting for him to start
const MAX_MS = 28000 // Sarvam's sync limit is 30s per clip

export function useVoice(config: VoiceConfig, onFinal: Final, onNothingHeard?: () => void) {
  const [listening, setListening] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [interim, setInterim] = useState('')
  const [speaking, setSpeaking] = useState(false)
  const [micError, setMicError] = useState<string | null>(null)
  const finalRef = useRef(onFinal)
  finalRef.current = onFinal
  const nothingRef = useRef(onNothingHeard)
  nothingRef.current = onNothingHeard
  const stopRef = useRef<(() => void) | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const speakDone = useRef<(() => void) | null>(null)

  const browserRecognitionCtor = () =>
    typeof window === 'undefined' ? null : (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
  const supported = typeof window !== 'undefined' && (
    config.provider === 'sarvam' ? !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined' : !!browserRecognitionCtor()
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
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
    } catch {
      setMicError('Microphone permission is blocked. Allow it in the browser’s site settings.')
      return
    }
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((m) => MediaRecorder.isTypeSupported(m)) || ''
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
    const chunks: Blob[] = []
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data)

    const ctx = new AudioContext()
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 1024
    ctx.createMediaStreamSource(stream).connect(analyser)
    const buf = new Uint8Array(analyser.fftSize)
    const started = Date.now()
    let heard = false
    let lastVoice = Date.now()
    let raf = 0
    let done = false

    const finish = () => {
      if (done) return
      done = true
      cancelAnimationFrame(raf)
      if (recorder.state !== 'inactive') recorder.stop()
    }
    stopRef.current = finish

    const tick = () => {
      analyser.getByteTimeDomainData(buf)
      let sum = 0
      for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v }
      const rms = Math.sqrt(sum / buf.length)
      const now = Date.now()
      if (rms > 0.035) { heard = true; lastVoice = now }
      if ((heard && now - lastVoice > SILENCE_MS) || (!heard && now - started > NO_SPEECH_MS) || now - started > MAX_MS) { finish(); return }
      raf = requestAnimationFrame(tick)
    }

    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop())
      ctx.close().catch(() => {})
      setListening(false)
      stopRef.current = null
      if (!heard || chunks.length === 0) { nothingRef.current?.(); return }
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
        if (j.text) finalRef.current(j.text, j.language ?? null)
      } catch (err) {
        setMicError((err as Error).message)
      } finally {
        setTranscribing(false)
      }
    }

    recorder.start(250)
    setListening(true)
    raf = requestAnimationFrame(tick)
  }, [])

  const listenBrowser = useCallback(() => {
    const Ctor = browserRecognitionCtor()
    if (!Ctor) return
    const rec = new Ctor()
    rec.lang = 'en-IN'
    rec.interimResults = true
    rec.continuous = false
    let final = ''
    rec.onresult = (e: any) => {
      let live = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) final += e.results[i][0].transcript + ' '
        else live += e.results[i][0].transcript
      }
      setInterim((final + live).trim())
    }
    rec.onerror = () => setListening(false)
    rec.onend = () => {
      setListening(false)
      setInterim('')
      stopRef.current = null
      if (final.trim()) finalRef.current(final.trim(), null)
      else nothingRef.current?.()
    }
    stopRef.current = () => rec.stop()
    rec.start()
    setListening(true)
  }, [])

  const start = useCallback(() => {
    stopSpeaking()
    if (config.provider === 'sarvam') listenSarvam()
    else listenBrowser()
  }, [config.provider, listenSarvam, listenBrowser, stopSpeaking])

  const stop = useCallback(() => stopRef.current?.(), [])

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
  // hands-free conversation can start listening again right after.
  const speak = useCallback((text: string, preview?: { speaker: string; pace: number }) => new Promise<void>((resolve) => {
    if (!text.trim() || (!config.speakReplies && !preview)) { resolve(); return }
    stopSpeaking()
    setSpeaking(true)
    const end = () => { setSpeaking(false); speakDone.current = null; resolve() }
    speakDone.current = end
    if (config.provider !== 'sarvam') { speakBrowser(text, end); return }
    apiFetch('/api/assistant/speak', { method: 'POST', body: JSON.stringify({ text, ...preview }), timeoutMs: 40_000 })
      .then(async (res) => {
        const j = await res.json()
        if (!res.ok || !j.audio) throw new Error(j.error || 'no audio')
        if (speakDone.current !== end) return // interrupted meanwhile
        const audio = new Audio(`data:audio/mpeg;base64,${j.audio}`)
        audioRef.current = audio
        audio.onended = end
        audio.onerror = end
        await audio.play()
      })
      .catch(() => speakBrowser(text, end))
  }), [config.provider, config.speakReplies, speakBrowser, stopSpeaking])

  useEffect(() => () => { stopRef.current?.(); stopSpeaking() }, [stopSpeaking])

  return { supported, listening, transcribing, interim, speaking, micError, start, stop, speak, stopSpeaking }
}

// "Hey DB" / "DB, suno": a light always-on listener using the browser's free
// recogniser, only while the ERP tab is visible and the feature is switched on in
// Settings. It only looks for the wake phrase; what follows is recorded and
// understood by Sarvam. Pauses whenever DB herself is listening or talking.
const NAME_VARIANTS = ['db', 'd b', 'dee bee', 'debi', 'idbi', 'deebee', 'डीबी']

export function useWakeWord(enabled: boolean, phrases: string[], paused: boolean, onWake: () => void) {
  const wakeRef = useRef(onWake)
  wakeRef.current = onWake
  const [active, setActive] = useState(false)

  useEffect(() => {
    const Ctor = typeof window === 'undefined' ? null : (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!enabled || paused || !Ctor) { setActive(false); return }
    let stopped = false
    let rec: any = null
    const normal = phrases.map((p) => p.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim())
    const matches = (heard: string) => {
      const h = ` ${heard.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim()} `
      if (normal.some((p) => h.includes(` ${p} `))) return true
      // "hey/hi/hello/suno" next to any way the recogniser spells DB
      return NAME_VARIANTS.some((n) => new RegExp(`(hey|hi|hello|ok|suno)\\s+${n}\\b|\\b${n}\\s+suno`).test(h))
    }
    const begin = () => {
      if (stopped || document.visibilityState !== 'visible') return
      rec = new Ctor()
      rec.lang = 'en-IN'
      rec.continuous = true
      rec.interimResults = true
      rec.onresult = (e: any) => {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (matches(e.results[i][0].transcript)) { stopped = true; rec.abort(); setActive(false); wakeRef.current(); return }
        }
      }
      rec.onend = () => { if (!stopped) setTimeout(begin, 300) }
      rec.onerror = (e: any) => { if (e.error === 'not-allowed') { stopped = true; setActive(false) } }
      try { rec.start(); setActive(true) } catch { /* already started */ }
    }
    const onVis = () => { if (document.visibilityState === 'visible' && !stopped) begin() }
    document.addEventListener('visibilitychange', onVis)
    begin()
    return () => { stopped = true; document.removeEventListener('visibilitychange', onVis); try { rec?.abort() } catch {} setActive(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, paused, phrases.join('|')])

  return { active }
}
