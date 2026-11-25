'use client'

import { useEffect, useState } from 'react'

// Full-screen colour test. A script can't see the panel, so the engineer looks:
// each colour fills the whole screen, and they tap exactly where any dot or
// line is (saved with its position and colour) or press Next when it's clean.

export interface ScreenMark { color: string; x: number; y: number }

const COLOURS = [
  { name: 'white', css: '#ffffff' },
  { name: 'black', css: '#000000' },
  { name: 'red', css: '#ff0000' },
  { name: 'green', css: '#00ff00' },
  { name: 'blue', css: '#0000ff' },
  { name: 'grey', css: '#808080' },
]

const BLEED = [
  { name: 'black (look at the edges for light leaking in)', css: '#000000' },
  { name: 'grey gradient (look for bands, blotches and pressure marks)', css: 'linear-gradient(90deg, #000 0%, #fff 100%)' },
]

export function describeMark(m: ScreenMark) {
  const v = m.y < 0.33 ? 'top' : m.y > 0.66 ? 'bottom' : 'middle'
  const h = m.x < 0.33 ? 'left' : m.x > 0.66 ? 'right' : 'centre'
  return `dot on ${m.color}, ${v}-${h}`
}

// Safari before 16.4 (Catalina, Big Sur) only has the webkit-prefixed
// fullscreen API, and it returns nothing instead of a promise.
function enterFullscreen() {
  const el = document.documentElement as any
  try {
    if (el.requestFullscreen) Promise.resolve(el.requestFullscreen()).catch(() => {})
    else el.webkitRequestFullscreen?.()
  } catch { /* the colours still fill the window */ }
}
function leaveFullscreen() {
  const d = document as any
  try {
    if (d.fullscreenElement && d.exitFullscreen) Promise.resolve(d.exitFullscreen()).catch(() => {})
    else if (d.webkitFullscreenElement) d.webkitExitFullscreen?.()
  } catch { /* ignore */ }
}

function FullScreen({
  frames,
  allowMarks,
  onDone,
}: {
  frames: { name: string; css: string }[]
  allowMarks: boolean
  onDone: (marks: ScreenMark[]) => void
}) {
  const [i, setI] = useState(0)
  const [marks, setMarks] = useState<ScreenMark[]>([])
  const [showHelp, setShowHelp] = useState(true)

  useEffect(() => {
    enterFullscreen()
    const t = setTimeout(() => setShowHelp(false), 2500)
    return () => { clearTimeout(t); leaveFullscreen() }
  }, [])

  const next = () => {
    if (i + 1 >= frames.length) onDone(marks)
    else { setI(i + 1); setShowHelp(true); setTimeout(() => setShowHelp(false), 2000) }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'Enter' || e.code === 'ArrowRight') { e.preventDefault(); next() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const frame = frames[i]
  const dark = frame.css === '#000000' || frame.css === '#0000ff' || frame.css.startsWith('linear')
  return (
    <div
      className="fixed inset-0 z-[100] cursor-crosshair select-none"
      style={{ background: frame.css }}
      onClick={(e) => {
        if (!allowMarks) return
        setMarks((m) => [...m, { color: frame.name, x: e.clientX / window.innerWidth, y: e.clientY / window.innerHeight }])
      }}
    >
      {marks.filter((m) => m.color === frame.name).map((m, k) => (
        <div
          key={k}
          className="absolute size-8 -ml-4 -mt-4 rounded-full border-2"
          style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%`, borderColor: dark ? '#ff0' : '#f0f' }}
        />
      ))}
      <div
        className={`absolute inset-x-0 bottom-4 flex justify-center transition-opacity ${showHelp ? 'opacity-100' : 'opacity-30 hover:opacity-100'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="rounded-full bg-black/70 text-white text-sm px-4 py-2 flex items-center gap-3">
          <span>{i + 1}/{frames.length} · {frame.name}{allowMarks ? ' · tap any dot or line' : ''}</span>
          <button type="button" onClick={next} className="rounded-full bg-white text-black px-3 py-1 font-semibold">
            {i + 1 >= frames.length ? 'Done' : 'Next (Space)'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function ColourTest({ onDone }: { onDone: (marks: ScreenMark[]) => void }) {
  const [running, setRunning] = useState(false)
  if (running) return <FullScreen frames={COLOURS} allowMarks onDone={(m) => { setRunning(false); onDone(m) }} />
  return (
    <button type="button" onClick={() => setRunning(true)} className="rounded-lg bg-primary text-primary-foreground px-4 py-3 font-semibold">
      Start colour test (6 screens)
    </button>
  )
}

export function BleedTest({ onDone }: { onDone: () => void }) {
  const [running, setRunning] = useState(false)
  if (running) return <FullScreen frames={BLEED} allowMarks={false} onDone={() => { setRunning(false); onDone() }} />
  return (
    <button type="button" onClick={() => setRunning(true)} className="rounded-lg bg-primary text-primary-foreground px-4 py-3 font-semibold">
      Start bleed / pressure-mark test
    </button>
  )
}

// Touch screens: drag a finger over every cell of a grid.
export function TouchGrid({ onComplete }: { onComplete: () => void }) {
  const COLS = 10, ROWS = 6
  const [hit, setHit] = useState<Set<number>>(new Set())
  const [running, setRunning] = useState(false)

  const mark = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return
    const rect = e.currentTarget.getBoundingClientRect()
    const c = Math.floor(((e.clientX - rect.left) / rect.width) * COLS)
    const r = Math.floor(((e.clientY - rect.top) / rect.height) * ROWS)
    const idx = r * COLS + c
    if (c < 0 || r < 0 || c >= COLS || r >= ROWS || hit.has(idx)) return
    const next = new Set(hit); next.add(idx); setHit(next)
    if (next.size === COLS * ROWS) { setRunning(false); onComplete() }
  }

  if (!running) {
    return (
      <button type="button" onClick={() => setRunning(true)} className="rounded-lg bg-primary text-primary-foreground px-4 py-3 font-semibold">
        Start touch test
      </button>
    )
  }
  return (
    <div className="fixed inset-0 z-[100] bg-background touch-none" onPointerMove={mark} onPointerDown={mark}>
      <div className="grid h-full w-full" style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)` }}>
        {Array.from({ length: COLS * ROWS }).map((_, i) => (
          <div key={i} className={`border border-border ${hit.has(i) ? 'bg-success' : ''}`} />
        ))}
      </div>
      <button type="button" onClick={() => setRunning(false)} className="absolute top-3 right-3 rounded-full bg-black/70 text-white text-sm px-4 py-2">
        Stop ({hit.size}/{COLS * ROWS})
      </button>
    </div>
  )
}
