'use client'

import { useEffect, useId, useRef } from 'react'
import { cn } from '@/lib/utils'
import { DEFAULT_APPEARANCE, OUTFITS, SKINS, THEMES, type Appearance } from './appearance'

// DB's face. Three styles (Settings -> Look and feel):
//   face     -- a flat illustrated woman (outfit, skin tone, bindi, earrings
//               configurable) who blinks, tilts her head while listening and
//               moves her mouth while speaking;
//   orb      -- a glowing gradient orb that breathes and swells with the voice,
//               like the voice modes of ChatGPT / Gemini Live;
//   initials -- a calm gradient badge.
// SVG + CSS only: no images, video or 3D, so it costs nothing and stays smooth
// on phones. The live mic level / her voice level (levelRef, 0..1) drives the
// ring and the orb directly on the element, with no React re-render per frame.

export type AvatarState = 'idle' | 'listening' | 'thinking' | 'speaking'
export type AvatarLook = Pick<Appearance, 'avatar' | 'theme' | 'outfit' | 'skin' | 'bindi' | 'earrings' | 'motion'>

const CSS = `
@keyframes dbav-blink { 0%, 92%, 100% { transform: scaleY(1) } 95% { transform: scaleY(0.1) } }
@keyframes dbav-talk { 0% { transform: scaleY(0.35) } 50% { transform: scaleY(1) } 100% { transform: scaleY(0.55) } }
@keyframes dbav-bob { 0%, 100% { transform: translateY(0) } 50% { transform: translateY(-1.2px) } }
@keyframes dbav-spin { to { transform: rotate(360deg) } }
@keyframes dbav-breathe { 0%, 100% { transform: scale(0.96) } 50% { transform: scale(1.02) } }
@keyframes dbav-glow { 0%, 100% { opacity: 0.45 } 50% { opacity: 0.9 } }
.dbav-eyes { transform-box: fill-box; transform-origin: center; animation: dbav-blink 4.8s infinite; }
.dbav-mouth { transform-box: fill-box; transform-origin: center; animation: dbav-talk 0.28s ease-in-out infinite alternate; }
.dbav-head { transform-box: view-box; transform-origin: 50px 70px; transition: transform 0.4s ease; }
.dbav-idle .dbav-head { animation: dbav-bob 5s ease-in-out infinite; }
.dbav-listening .dbav-head { transform: rotate(-4deg); }
.dbav-thinking .dbav-pupils { transform: translate(1.2px, -1.4px); }
.dbav-pupils { transition: transform 0.4s ease; }
.dbav-reduced *, .dbav-reduced { animation: none !important; transition: none !important; }
@media (prefers-reduced-motion: reduce) { .dbav-eyes, .dbav-mouth, .dbav-head, .dbav-orb-swirl { animation: none !important; } }
`

export function DbAvatar({ state = 'idle', size = 48, levelRef, look, className }: {
  state?: AvatarState
  size?: number
  levelRef?: { current: number }
  look?: Partial<AvatarLook>
  className?: string
}) {
  const l = { ...DEFAULT_APPEARANCE, ...look }
  const theme = THEMES[l.theme] || THEMES.violet
  const ring = useRef<HTMLDivElement>(null)
  const core = useRef<HTMLDivElement>(null)
  const uid = useId().replace(/:/g, '')
  const reduced = l.motion === 'reduced'
  const live = state === 'listening' || state === 'speaking'

  // Swell with the voice: yours while she listens, hers while she speaks.
  useEffect(() => {
    if (!live || !levelRef || reduced) return
    let raf = 0
    let smooth = 0
    const tick = () => {
      const target = Math.min(1, (levelRef.current || 0) * 6)
      smooth += (target - smooth) * 0.35
      if (ring.current) { ring.current.style.transform = `scale(${1.04 + smooth * 0.24})`; ring.current.style.opacity = String(0.3 + smooth * 0.65) }
      if (core.current) core.current.style.transform = `scale(${0.94 + smooth * 0.14})`
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf); if (core.current) core.current.style.transform = '' }
  }, [live, levelRef, reduced])

  const ringColor = state === 'speaking' ? theme.glowSpeak : theme.glowListen
  return (
    <div className={cn('relative shrink-0', reduced && 'dbav-reduced', className)} style={{ width: size, height: size }}>
      <style>{CSS}</style>
      {live && <div ref={ring} className="absolute inset-0 rounded-full" style={{ background: ringColor, opacity: 0.45, transform: 'scale(1.06)', filter: `blur(${Math.max(1, size / 40)}px)` }} />}
      {state === 'thinking' && (
        <div className="absolute -inset-[3px] rounded-full" style={{
          background: `conic-gradient(from 0deg, ${theme.from}, ${theme.to}, ${theme.glowListen}, ${theme.from})`,
          WebkitMask: 'radial-gradient(farthest-side, transparent calc(100% - 3px), #000 0)',
          mask: 'radial-gradient(farthest-side, transparent calc(100% - 3px), #000 0)',
          animation: 'dbav-spin 1.1s linear infinite',
        }} />
      )}
      <div ref={core} className="relative h-full w-full rounded-full transition-transform duration-75">
        {l.avatar === 'orb' ? <Orb theme={theme} state={state} />
          : l.avatar === 'initials' ? <Initials theme={theme} size={size} />
          : <Face theme={theme} state={state} look={l} uid={uid} />}
      </div>
    </div>
  )
}

function Orb({ theme, state }: { theme: typeof THEMES[keyof typeof THEMES]; state: AvatarState }) {
  const speed = state === 'thinking' ? '2.2s' : state === 'idle' ? '9s' : '4s'
  return (
    <div className="relative h-full w-full overflow-hidden rounded-full" style={{ background: `radial-gradient(circle at 35% 30%, ${theme.from}, ${theme.to} 70%)`, animation: 'dbav-breathe 4s ease-in-out infinite' }}>
      <div className="dbav-orb-swirl absolute -inset-1/4" style={{
        background: `conic-gradient(from 0deg, transparent, ${theme.glowListen}55, transparent 35%, ${theme.glowSpeak}66, transparent 70%)`,
        animation: `dbav-spin ${speed} linear infinite`, filter: 'blur(6px)',
      }} />
      <div className="absolute left-[18%] top-[14%] h-[34%] w-[42%] rounded-full bg-white/40 blur-[3px]" />
      <div className="absolute inset-0 rounded-full ring-1 ring-inset ring-white/25" />
    </div>
  )
}

function Initials({ theme, size }: { theme: typeof THEMES[keyof typeof THEMES]; size: number }) {
  return (
    <div className="flex h-full w-full items-center justify-center rounded-full font-semibold tracking-tight text-white"
      style={{ background: `linear-gradient(135deg, ${theme.from}, ${theme.to})`, fontSize: Math.max(10, size * 0.36) }}>
      DB
    </div>
  )
}

function Face({ theme, state, look, uid }: { theme: typeof THEMES[keyof typeof THEMES]; state: AvatarState; look: Appearance; uid: string }) {
  const skin = SKINS[look.skin] || SKINS.medium
  const outfit = (OUTFITS[look.outfit] || OUTFITS.teal).color
  return (
    <svg viewBox="0 0 100 100" className={cn('h-full w-full rounded-full', `dbav-${state}`)} role="img" aria-label="DB">
      <defs>
        <linearGradient id={`bg${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={theme.from} stopOpacity="0.85" />
          <stop offset="100%" stopColor={theme.to} stopOpacity="0.85" />
        </linearGradient>
        <clipPath id={`clip${uid}`}><circle cx="50" cy="50" r="50" /></clipPath>
      </defs>
      <g clipPath={`url(#clip${uid})`}>
        <rect width="100" height="100" fill={`url(#bg${uid})`} />
        <g className="dbav-head">
          <path d="M23 54 C20 28 35 14 50 14 C66 14 81 28 78 54 L82 88 C70 95 30 95 18 88 Z" fill="#2a1a16" />
          <path d="M12 104 C15 82 33 75 50 75 C67 75 85 82 88 104 Z" fill={outfit} />
          <path d="M40 75 Q50 83 60 75" fill="none" stroke="#f59e0b" strokeWidth="1.6" />
          <rect x="44" y="62" width="12" height="15" rx="5" fill={skin.shade} />
          <ellipse cx="31.5" cy="49" rx="3.2" ry="4.2" fill={skin.shade} />
          <ellipse cx="68.5" cy="49" rx="3.2" ry="4.2" fill={skin.shade} />
          {look.earrings && <><circle cx="31.5" cy="55.5" r="1.7" fill="#fbbf24" /><circle cx="68.5" cy="55.5" r="1.7" fill="#fbbf24" /></>}
          <ellipse cx="50" cy="47" rx="18.5" ry="21.5" fill={skin.face} />
          <path d="M31 44 C31 27 43 21 53 22 C64 23 71 31 70 45 C66 35 58 30 48 31 C41 32 35 37 31 44 Z" fill="#2a1a16" />
          <path d="M38.5 39.5 Q42.5 37.6 46 39.4" fill="none" stroke="#3a2520" strokeWidth="1.3" strokeLinecap="round" />
          <path d="M54 39.4 Q57.5 37.6 61.5 39.5" fill="none" stroke="#3a2520" strokeWidth="1.3" strokeLinecap="round" />
          {look.bindi && <circle cx="50" cy="38.6" r="1.05" fill="#dc2626" />}
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
          <path d="M50 48.5 Q48.8 53 50.8 54" fill="none" stroke={skin.shade} strokeWidth="1.1" strokeLinecap="round" />
          <circle cx="39" cy="54.5" r="3.4" fill="#f59e8b" opacity="0.35" />
          <circle cx="61" cy="54.5" r="3.4" fill="#f59e8b" opacity="0.35" />
          {state === 'speaking'
            ? <ellipse className="dbav-mouth" cx="50" cy="59.3" rx="3.4" ry="2.4" fill="#9f3a3a" />
            : <path d="M44.5 58 Q50 62.4 55.5 58" fill="none" stroke="#b4534b" strokeWidth="1.6" strokeLinecap="round" />}
        </g>
      </g>
    </svg>
  )
}
