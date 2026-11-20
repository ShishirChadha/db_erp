'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

// Browser speech for DB: recognition (tap to talk) and speech output, both
// built into Chrome / Safari, free and with no extra service. en-IN copes with
// Hinglish reasonably; anything it mishears is caught by DB's read-back before
// a save. Falls back to typing where recognition is not available.
type Recognition = {
  lang: string
  interimResults: boolean
  continuous: boolean
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((e: any) => void) | null
  onerror: ((e: any) => void) | null
  onend: (() => void) | null
}

export function useVoice(onFinalText: (text: string) => void) {
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [supported, setSupported] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const recRef = useRef<Recognition | null>(null)
  const finalRef = useRef('')
  const callbackRef = useRef(onFinalText)
  callbackRef.current = onFinalText

  useEffect(() => {
    const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    setSupported(!!Ctor)
  }, [])

  const start = useCallback(() => {
    const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!Ctor) return
    window.speechSynthesis?.cancel()
    setSpeaking(false)
    const rec: Recognition = new Ctor()
    rec.lang = 'en-IN'
    rec.interimResults = true
    rec.continuous = true
    finalRef.current = ''
    rec.onresult = (e: any) => {
      let live = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        if (r.isFinal) finalRef.current += r[0].transcript + ' '
        else live += r[0].transcript
      }
      setInterim((finalRef.current + live).trim())
    }
    rec.onerror = () => setListening(false)
    rec.onend = () => {
      setListening(false)
      const text = finalRef.current.trim() || ''
      setInterim('')
      if (text) callbackRef.current(text)
    }
    recRef.current = rec
    rec.start()
    setListening(true)
  }, [])

  const stop = useCallback(() => recRef.current?.stop(), [])

  const speak = useCallback((text: string) => {
    const synth = window.speechSynthesis
    if (!synth || !text.trim()) return
    synth.cancel()
    const u = new SpeechSynthesisUtterance(text.replace(/[*_#`]/g, ''))
    const voices = synth.getVoices()
    u.voice = voices.find((v) => v.lang === 'en-IN' && /female|veena|heera|neerja|google/i.test(v.name))
      || voices.find((v) => v.lang === 'en-IN')
      || voices.find((v) => v.lang === 'hi-IN')
      || null
    u.lang = u.voice?.lang || 'en-IN'
    u.rate = 1.02
    u.onstart = () => setSpeaking(true)
    u.onend = () => setSpeaking(false)
    u.onerror = () => setSpeaking(false)
    synth.speak(u)
  }, [])

  const stopSpeaking = useCallback(() => { window.speechSynthesis?.cancel(); setSpeaking(false) }, [])

  return { supported, listening, interim, speaking, start, stop, speak, stopSpeaking }
}
