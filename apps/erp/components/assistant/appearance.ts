// DB's look and feel -- every option shown in Settings -> DB Assistant -> Look
// and feel, with its default. Plain data (no React, no server imports) so both
// the panel and the server-side settings can use it.

export const THEMES = {
  violet: { label: 'Violet', from: '#6366f1', to: '#ec4899', glowListen: '#34d399', glowSpeak: '#f472b6' },
  ocean: { label: 'Ocean', from: '#0ea5e9', to: '#14b8a6', glowListen: '#22d3ee', glowSpeak: '#38bdf8' },
  sunset: { label: 'Sunset', from: '#f97316', to: '#e11d48', glowListen: '#fbbf24', glowSpeak: '#fb7185' },
  emerald: { label: 'Emerald', from: '#10b981', to: '#0f766e', glowListen: '#6ee7b7', glowSpeak: '#2dd4bf' },
  royal: { label: 'Royal', from: '#7c3aed', to: '#1d4ed8', glowListen: '#a78bfa', glowSpeak: '#60a5fa' },
  graphite: { label: 'Graphite', from: '#334155', to: '#0f172a', glowListen: '#94a3b8', glowSpeak: '#cbd5e1' },
} as const
export type ThemeKey = keyof typeof THEMES

export const OUTFITS = {
  teal: { label: 'Teal', color: '#0d9488' }, maroon: { label: 'Maroon', color: '#9f1239' }, navy: { label: 'Navy', color: '#1e3a8a' },
  mustard: { label: 'Mustard', color: '#ca8a04' }, pink: { label: 'Pink', color: '#db2777' }, white: { label: 'White', color: '#f1f5f9' },
} as const
export const SKINS = {
  light: { label: 'Light', face: '#f6d2b5', shade: '#ecb995' }, medium: { label: 'Medium', face: '#f3c6a2', shade: '#e3a982' },
  wheat: { label: 'Wheat', face: '#d9a47c', shade: '#c78d63' }, deep: { label: 'Deep', face: '#a8714d', shade: '#8f5c3b' },
} as const

export interface Appearance {
  theme: ThemeKey
  // 'photo': the owner's own picture (Settings -> Look -> Your picture),
  // falling back to the face until one is uploaded.
  avatar: 'face' | 'orb' | 'initials' | 'photo'
  outfit: keyof typeof OUTFITS
  skin: keyof typeof SKINS
  bindi: boolean
  earrings: boolean
  // How a voice conversation looks: inside the chat with a live transcript
  // (ChatGPT style), a full "voice stage" with a big avatar and captions
  // (Gemini Live style), or auto: stage on phones/tablets, chat on a laptop.
  voice_view: 'auto' | 'chat' | 'stage'
  captions: boolean
  edge_glow: boolean // glowing screen edge while she listens / speaks
  haptics: boolean // short vibration on Android when she starts listening
  sounds: boolean // soft chime when she starts / stops listening
  motion: 'full' | 'reduced'
  text_size: 'sm' | 'md' | 'lg'
  bubbles: 'bubbles' | 'minimal'
  timestamps: boolean
  // Screens 600-1279 px wide -- a Galaxy Z Fold opened up, a tablet, a split
  // window: 'split' puts DB beside the ERP (the page narrows), 'float' lays her
  // over it. Under 600 px (Fold cover screen, phones) she is always full screen;
  // from 1280 px she always sits beside the ERP.
  wide_layout: 'split' | 'float'
  panel_side: 'right' | 'left'
  panel_width: 'compact' | 'regular' | 'wide'
  launcher_side: 'right' | 'left'
  launcher_size: 'sm' | 'md' | 'lg'
}

export const DEFAULT_APPEARANCE: Appearance = {
  theme: 'violet', avatar: 'face', outfit: 'teal', skin: 'medium', bindi: true, earrings: true,
  voice_view: 'auto', captions: true, edge_glow: true, haptics: true, sounds: true, motion: 'full',
  text_size: 'md', bubbles: 'bubbles', timestamps: false, wide_layout: 'split',
  panel_side: 'right', panel_width: 'regular', launcher_side: 'right', launcher_size: 'md',
}

// Allowed values per field, used by the API to validate and by Settings to render.
export const APPEARANCE_OPTIONS: { [K in keyof Appearance]: readonly Appearance[K][] } = {
  theme: Object.keys(THEMES) as ThemeKey[],
  avatar: ['face', 'orb', 'initials', 'photo'],
  outfit: Object.keys(OUTFITS) as (keyof typeof OUTFITS)[],
  skin: Object.keys(SKINS) as (keyof typeof SKINS)[],
  bindi: [true, false], earrings: [true, false],
  voice_view: ['auto', 'chat', 'stage'],
  captions: [true, false], edge_glow: [true, false], haptics: [true, false], sounds: [true, false],
  motion: ['full', 'reduced'],
  text_size: ['sm', 'md', 'lg'],
  bubbles: ['bubbles', 'minimal'],
  timestamps: [true, false],
  wide_layout: ['split', 'float'],
  panel_side: ['right', 'left'],
  panel_width: ['compact', 'regular', 'wide'],
  launcher_side: ['right', 'left'],
  launcher_size: ['sm', 'md', 'lg'],
}

export function cleanAppearance(input: unknown): Appearance {
  const src = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const out: any = { ...DEFAULT_APPEARANCE }
  for (const k of Object.keys(APPEARANCE_OPTIONS) as (keyof Appearance)[]) {
    if ((APPEARANCE_OPTIONS[k] as readonly unknown[]).includes(src[k])) out[k] = src[k]
  }
  return out
}

export const PANEL_WIDTH = { compact: 340, regular: 400, wide: 480 } as const
export const LAUNCHER_SIZE = { sm: 48, md: 56, lg: 68 } as const
export const TEXT_SIZE = { sm: 'text-[13px]', md: 'text-sm', lg: 'text-base' } as const
