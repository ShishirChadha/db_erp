'use client'

import { useEffect, useRef, useState } from 'react'

// Trackpad, speakers, microphone and camera tests for the /qc-test page.
// Each one only gathers evidence; the engineer still presses Works / Problem.

// ---------- Trackpad ----------

export function TrackpadTest({ onComplete }: { onComplete: () => void }) {
  const [seen, setSeen] = useState({ left: false, right: false, scroll: false, tl: false, tr: false, bl: false, br: false })
  const done = Object.values(seen).every(Boolean)
  const fired = useRef(false)
  useEffect(() => { if (done && !fired.current) { fired.current = true; onComplete() } }, [done, onComplete])

  const set = (k: keyof typeof seen) => setSeen((s) => (s[k] ? s : { ...s, [k]: true }))
  const item = (ok: boolean, label: string) => (
    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${ok ? 'bg-success text-success-foreground' : 'bg-muted text-muted-foreground'}`}>{ok ? '✓ ' : ''}{label}</span>
  )

  return (
    <div className="space-y-3">
      <div
        className="relative h-56 rounded-xl border-2 border-dashed bg-muted/40 select-none"
        onMouseDown={(e) => set(e.button === 2 ? 'right' : 'left')}
        onContextMenu={(e) => { e.preventDefault(); set('right') }}
        onWheel={() => set('scroll')}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height
          if (x < 0.12 && y < 0.15) set('tl')
          if (x > 0.88 && y < 0.15) set('tr')
          if (x < 0.12 && y > 0.85) set('bl')
          if (x > 0.88 && y > 0.85) set('br')
        }}
      >
        {(['tl', 'tr', 'bl', 'br'] as const).map((c) => (
          <div key={c} className={`absolute size-10 rounded ${seen[c] ? 'bg-success' : 'bg-primary/20'} ${c[0] === 't' ? 'top-1' : 'bottom-1'} ${c[1] === 'l' ? 'left-1' : 'right-1'}`} />
        ))}
        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground text-center px-16 pointer-events-none">
          Inside this box: left-click, right-click, scroll with two fingers, and touch all four corners with the pointer.
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {item(seen.left, 'Left click')}{item(seen.right, 'Right click')}{item(seen.scroll, 'Two-finger scroll')}
        {item(seen.tl && seen.tr && seen.bl && seen.br, 'All corners')}
      </div>
    </div>
  )
}

// ---------- Speakers ----------

function tone(pan: number, from: number, to: number, seconds: number) {
  const Ctx = window.AudioContext || (window as any).webkitAudioContext
  const ctx: AudioContext = new Ctx()
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  const panner = ctx.createStereoPanner()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(from, ctx.currentTime)
  if (to !== from) osc.frequency.exponentialRampToValueAtTime(to, ctx.currentTime + seconds)
  gain.gain.setValueAtTime(0.0001, ctx.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.5, ctx.currentTime + 0.05)
  gain.gain.setValueAtTime(0.5, ctx.currentTime + seconds - 0.1)
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + seconds)
  panner.pan.value = pan
  osc.connect(gain).connect(panner).connect(ctx.destination)
  osc.start()
  osc.stop(ctx.currentTime + seconds)
  osc.onended = () => ctx.close()
}

export function SpeakerTest() {
  const b = 'rounded-lg border bg-card hover:bg-muted px-4 py-3 text-sm font-semibold'
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">Set the volume to about 70%. Each sound should come only from the side named, with no crackle, buzz or rattle.</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={b} onClick={() => tone(-1, 440, 440, 1.5)}>▶ Left speaker</button>
        <button type="button" className={b} onClick={() => tone(1, 440, 440, 1.5)}>▶ Right speaker</button>
        <button type="button" className={b} onClick={() => tone(0, 60, 12000, 8)}>▶ Low-to-high sweep (rattle check)</button>
      </div>
    </div>
  )
}

// ---------- Microphone ----------

export function MicTest() {
  const [level, setLevel] = useState(0)
  const [state, setState] = useState<'idle' | 'recording' | 'recorded' | 'error'>('idle')
  const [url, setUrl] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number>(0)

  useEffect(() => () => { cancelAnimationFrame(rafRef.current); streamRef.current?.getTracks().forEach((t) => t.stop()) }, [])

  const record = async () => {
    try {
      setErr('')
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const ctx = new AudioContext()
      const analyser = ctx.createAnalyser()
      ctx.createMediaStreamSource(stream).connect(analyser)
      const data = new Uint8Array(analyser.fftSize)
      const tick = () => {
        analyser.getByteTimeDomainData(data)
        let peak = 0
        for (const v of data) peak = Math.max(peak, Math.abs(v - 128))
        setLevel(Math.min(100, Math.round((peak / 128) * 160)))
        rafRef.current = requestAnimationFrame(tick)
      }
      tick()
      const rec = new MediaRecorder(stream)
      const chunks: Blob[] = []
      rec.ondataavailable = (e) => chunks.push(e.data)
      rec.onstop = () => {
        cancelAnimationFrame(rafRef.current)
        stream.getTracks().forEach((t) => t.stop())
        ctx.close()
        const blobUrl = URL.createObjectURL(new Blob(chunks, { type: rec.mimeType }))
        setUrl(blobUrl)
        setState('recorded')
        new Audio(blobUrl).play().catch(() => {})
      }
      rec.start()
      setState('recording')
      setTimeout(() => rec.state === 'recording' && rec.stop(), 4000)
    } catch (e: any) {
      setErr(e?.message || 'Microphone not available')
      setState('error')
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">Press record and speak normally for 4 seconds. It plays back automatically — your voice should be clear, not faint or crackly.</p>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={state === 'recording'} onClick={record} className="rounded-lg bg-primary text-primary-foreground px-4 py-3 text-sm font-semibold disabled:opacity-50">
          {state === 'recording' ? 'Recording…' : state === 'recorded' ? '● Record again' : '● Record 4 seconds'}
        </button>
        {url && <button type="button" onClick={() => new Audio(url).play()} className="rounded-lg border px-4 py-3 text-sm font-semibold">▶ Play again</button>}
      </div>
      <div className="h-3 rounded-full bg-muted overflow-hidden"><div className="h-full bg-success transition-[width]" style={{ width: `${level}%` }} /></div>
      {err && <p className="text-sm text-destructive">{err} — allow microphone access when the browser asks, or mark Problem.</p>}
    </div>
  )
}

// ---------- Camera ----------

export function CameraTest() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [info, setInfo] = useState('')
  const [err, setErr] = useState('')
  const [on, setOn] = useState(false)
  const streamRef = useRef<MediaStream | null>(null)

  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), [])

  const start = async () => {
    try {
      setErr('')
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1920 }, height: { ideal: 1080 } } })
      streamRef.current = stream
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play().catch(() => {}) }
      const s = stream.getVideoTracks()[0]?.getSettings()
      const label = stream.getVideoTracks()[0]?.label
      setInfo(`${label || 'Camera'}${s?.width ? ` · ${s.width}×${s.height}` : ''}`)
      setOn(true)
    } catch (e: any) {
      setErr(e?.message || 'Camera not available')
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">The picture should be clear and sharp, with no spots, lines, dark corners or flicker.</p>
      {!on && <button type="button" onClick={start} className="rounded-lg bg-primary text-primary-foreground px-4 py-3 text-sm font-semibold">Turn on camera</button>}
      <video ref={videoRef} muted playsInline className={`w-full max-w-md rounded-lg bg-black ${on ? '' : 'hidden'}`} />
      {info && <p className="text-xs text-muted-foreground">{info}</p>}
      {err && <p className="text-sm text-destructive">{err} — allow camera access when the browser asks, or mark Problem.</p>}
    </div>
  )
}
