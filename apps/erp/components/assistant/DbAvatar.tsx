'use client'

import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'

// DB's face: a flat illustrated avatar drawn in SVG, animated with CSS only
// (blinks, tilts her head while listening, moves her mouth while speaking).
// No images, video or 3D -- costs nothing to run and stays smooth on phones.

export type AvatarState = 'idle' | 'listening' | 'thinking' | 'speaking'

const CSS = `
@keyframes dbav-blink { 0%, 92%, 100% { transform: scaleY(1) } 95% { transform: scaleY(0.1) } }
@keyframes dbav-talk { 0% { transform: scaleY(0.35) } 50% { transform: scaleY(1) } 100% { transform: scaleY(0.55) } }
@keyframes dbav-bob { 0%, 100% { transform: translateY(0) } 50% { transform: translateY(-1.2px) } }
@keyframes dbav-spin { to { transform: rotate(360deg) } }
@keyframes dbav-glow { 0%, 100% { box-shadow: 0 0 0 0 rgba(236, 72, 153, 0.35) } 50% { box-shadow: 0 0 0 8px rgba(236, 72, 153, 0) } }
.dbav-eyes { transform-box: fill-box; transform-origin: center; animation: dbav-blink 4.8s infinite; }
.dbav-mouth { transform-box: fill-box; transform-origin: center; animation: dbav-talk 0.28s ease-in-out infinite alternate; }
.dbav-head { transform-box: view-box; transform-origin: 50px 70px; transition: transform 0.4s ease; }
.dbav-idle .dbav-head { animation: dbav-bob 5s ease-in-out infinite; }
.dbav-listening .dbav-head { transform: rotate(-4deg); }
.dbav-thinking .dbav-pupils { transform: translate(1.2px, -1.4px); }
.dbav-pupils { transition: transform 0.4s ease; }
@media (prefers-reduced-motion: reduce) { .dbav-eyes, .dbav-mouth, .dbav-head { animation: none !important; } }
`

export function DbAvatar({ state = 'idle', size = 48, levelRef, className }: {
  state?: AvatarState
  size?: number
  levelRef?: { current: number }
  className?: string
}) {
  const ring = useRef<HTMLDivElement>(null)

  // Listening: a ring that grows with the live mic level. Written straight to
  // the element (no React re-render per frame).
  useEffect(() => {
    if (state !== 'listening' || !levelRef) return
    let raf = 0
    const tick = () => {
      const l = Math.min(1, (levelRef.current || 0) * 6)
      if (ring.current) { ring.current.style.transform = `scale(${1.04 + l * 0.22})`; ring.current.style.opacity = String(0.35 + l * 0.6) }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [state, levelRef])

  return (
    <div className={cn('relative shrink-0', className)} style={{ width: size, height: size }}>
      <style>{CSS}</style>
      {state === 'listening' && <div ref={ring} className="absolute inset-0 rounded-full bg-emerald-400/50" style={{ transform: 'scale(1.06)' }} />}
      {state === 'thinking' && (
        <div className="absolute -inset-[3px] rounded-full" style={{
          background: 'conic-gradient(from 0deg, #6366f1, #ec4899, #f59e0b, #6366f1)',
          WebkitMask: 'radial-gradient(farthest-side, transparent calc(100% - 3px), #000 0)',
          mask: 'radial-gradient(farthest-side, transparent calc(100% - 3px), #000 0)',
          animation: 'dbav-spin 1.1s linear infinite',
        }} />
      )}
      <div className="relative h-full w-full rounded-full" style={state === 'speaking' ? { animation: 'dbav-glow 1.4s ease-out infinite' } : undefined}>
        <svg viewBox="0 0 100 100" className={cn('h-full w-full', `dbav-${state}`)} role="img" aria-label="DB">
          <defs>
            <linearGradient id="dbav-bg" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#818cf8" />
              <stop offset="100%" stopColor="#f472b6" />
            </linearGradient>
            <clipPath id="dbav-clip"><circle cx="50" cy="50" r="50" /></clipPath>
          </defs>
          <g clipPath="url(#dbav-clip)">
            <rect width="100" height="100" fill="url(#dbav-bg)" />
            <g className="dbav-head">
              {/* hair, back */}
              <path d="M23 54 C20 28 35 14 50 14 C66 14 81 28 78 54 L82 88 C70 95 30 95 18 88 Z" fill="#2a1a16" />
              {/* shoulders (kurta) and neck */}
              <path d="M12 104 C15 82 33 75 50 75 C67 75 85 82 88 104 Z" fill="#0d9488" />
              <path d="M40 75 Q50 83 60 75" fill="none" stroke="#f59e0b" strokeWidth="1.6" />
              <rect x="44" y="62" width="12" height="15" rx="5" fill="#e3a982" />
              {/* face */}
              <ellipse cx="31.5" cy="49" rx="3.2" ry="4.2" fill="#eab48f" />
              <ellipse cx="68.5" cy="49" rx="3.2" ry="4.2" fill="#eab48f" />
              <circle cx="31.5" cy="55.5" r="1.7" fill="#fbbf24" />
              <circle cx="68.5" cy="55.5" r="1.7" fill="#fbbf24" />
              <ellipse cx="50" cy="47" rx="18.5" ry="21.5" fill="#f3c6a2" />
              {/* hair, front: side-swept fringe */}
              <path d="M31 44 C31 27 43 21 53 22 C64 23 71 31 70 45 C66 35 58 30 48 31 C41 32 35 37 31 44 Z" fill="#2a1a16" />
              {/* brows, bindi */}
              <path d="M38.5 39.5 Q42.5 37.6 46 39.4" fill="none" stroke="#3a2520" strokeWidth="1.3" strokeLinecap="round" />
              <path d="M54 39.4 Q57.5 37.6 61.5 39.5" fill="none" stroke="#3a2520" strokeWidth="1.3" strokeLinecap="round" />
              <circle cx="50" cy="38.6" r="1.05" fill="#dc2626" />
              {/* eyes */}
              <g className="dbav-eyes">
                <ellipse cx="43" cy="46" rx="2.4" ry="2.9" fill="#fff" />
                <ellipse cx="57" cy="46" rx="2.4" ry="2.9" fill="#fff" />
                <g className="dbav-pupils">
                  <circle cx="43" cy="46.3" r="1.75" fill="#2a1a16" />
                  <circle cx="57" cy="46.3" r="1.75" fill="#2a1a16" />
                  <circle cx="43.6" cy="45.6" r="0.5" fill="#fff" />
                  <circle cx="57.6" cy="45.6" r="0.5" fill="#fff" />
                </g>
              </g>
              {/* nose, cheeks */}
              <path d="M50 48.5 Q48.8 53 50.8 54" fill="none" stroke="#d29a76" strokeWidth="1.1" strokeLinecap="round" />
              <circle cx="39" cy="54.5" r="3.4" fill="#f59e8b" opacity="0.35" />
              <circle cx="61" cy="54.5" r="3.4" fill="#f59e8b" opacity="0.35" />
              {/* mouth */}
              {state === 'speaking'
                ? <ellipse className="dbav-mouth" cx="50" cy="59.3" rx="3.4" ry="2.4" fill="#9f3a3a" />
                : <path d="M44.5 58 Q50 62.4 55.5 58" fill="none" stroke="#b4534b" strokeWidth="1.6" strokeLinecap="round" />}
            </g>
          </g>
        </svg>
      </div>
    </div>
  )
}
