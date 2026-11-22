'use client'

import { useEffect, useRef, useState } from 'react'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import { apiFetch } from '@/lib/api-client'
import { DbAvatar, type AvatarState } from './DbAvatar'
import { OUTFITS, SKINS, THEMES, cleanAppearance, type Appearance } from './appearance'

// Settings -> DB Assistant -> Look and feel. Every visual option, with a live
// preview of DB in each state. Saved with the page's "Save changes".

function Choice<T extends string>({ value, options, onChange, name }: {
  value: T; name: string; options: readonly (readonly [T, string, string?])[]; onChange: (v: T) => void
}) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-2">
      {options.map(([v, label, hint]) => (
        <label key={v} className={cn('flex cursor-pointer items-start gap-2 rounded-md border p-2 text-sm', value === v && 'border-primary bg-primary/5')}>
          <input type="radio" name={name} className="mt-0.5" checked={value === v} onChange={() => onChange(v)} />
          <span>{label}{hint && <span className="block text-xs text-muted-foreground">{hint}</span>}</span>
        </label>
      ))}
    </div>
  )
}

function Swatches<K extends string>({ value, items, onChange }: { value: K; items: Record<K, { label: string; css: string }>; onChange: (k: K) => void }) {
  return (
    <div className="flex flex-wrap gap-3">
      {(Object.keys(items) as K[]).map((k) => (
        <button key={k} type="button" onClick={() => onChange(k)} className="flex flex-col items-center gap-1 text-xs" aria-pressed={value === k}>
          <span className={cn('h-9 w-9 rounded-full border-2 ring-1 ring-border', value === k ? 'border-foreground' : 'border-transparent')} style={{ background: items[k].css }} />
          {items[k].label}
        </button>
      ))}
    </div>
  )
}

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <Checkbox className="mt-0.5" checked={checked} onCheckedChange={(c) => onChange(!!c)} />
      <span>{label}{hint && <span className="block text-xs text-muted-foreground">{hint}</span>}</span>
    </label>
  )
}

// Her own picture: cropped to a centred 512 px square here in the browser (so
// the file is small), then saved privately via /api/assistant/avatar.
async function squarePicture(file: File): Promise<Blob> {
  let img: CanvasImageSource & { width: number; height: number }
  try { img = await createImageBitmap(file) } catch {
    const el = new Image()
    el.src = URL.createObjectURL(file)
    await el.decode()
    img = el
  }
  const side = Math.min(img.width, img.height)
  const size = Math.min(512, side)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  // Centred left-right; a little above centre top-bottom, where faces usually are.
  canvas.getContext('2d')!.drawImage(img, (img.width - side) / 2, Math.max(0, (img.height - side) * 0.3), side, side, 0, 0, size, size)
  const toBlob = (type: string, q: number) => new Promise<Blob | null>((res) => canvas.toBlob(res, type, q))
  const webp = await toBlob('image/webp', 0.88)
  if (webp && webp.type === 'image/webp') return webp // older Safari can't write WebP
  const jpeg = await toBlob('image/jpeg', 0.9)
  if (!jpeg) throw new Error('Could not read that picture.')
  return jpeg
}

function PhotoUpload({ version, onChange }: { version: string; onChange: (v: string) => void }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const upload = async (file: File | undefined) => {
    if (!file) return
    setBusy(true); setErr(null)
    try {
      const form = new FormData()
      form.append('image', await squarePicture(file), 'db.jpg')
      const res = await apiFetch('/api/assistant/avatar', { method: 'POST', body: form })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || 'Upload failed.')
      onChange(j.version)
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const remove = async () => {
    setBusy(true); setErr(null)
    const res = await apiFetch('/api/assistant/avatar', { method: 'DELETE' })
    if (res.ok) onChange('')
    else setErr('Could not remove the picture.')
    setBusy(false)
  }
  return (
    <div className="space-y-2 rounded-md bg-muted p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <label className={cn('inline-flex h-8 cursor-pointer items-center rounded-md border bg-background px-3 font-medium hover:bg-muted', busy && 'pointer-events-none opacity-60')}>
          {busy ? 'Saving…' : version ? 'Change picture' : 'Upload picture'}
          <input type="file" accept="image/*" className="hidden" disabled={busy}
            onChange={(e) => { upload(e.target.files?.[0]); e.target.value = '' }} />
        </label>
        {version && <button type="button" onClick={remove} disabled={busy} className="h-8 rounded-md px-3 text-muted-foreground hover:bg-background">Remove</button>}
      </div>
      {err && <p className="text-xs text-destructive">{err}</p>}
      <p className="text-xs text-muted-foreground">
        A picture with her face in the middle works best; it is cropped to a circle, gets the same glow while she listens and
        speaks, and is kept private (only your login can load it). Use an AI-generated picture of a made-up person, not a real
        woman’s photo, which would need her permission. The picture is saved at once; press Save changes to switch her look
        to it. Until one is uploaded she shows her illustrated face.
      </p>
    </div>
  )
}

export default function AssistantLookSettings({ value, onChange, photoVersion = '', onPhotoChange }: {
  value: unknown; onChange: (a: Appearance) => void; photoVersion?: string; onPhotoChange?: (v: string) => void
}) {
  const a = cleanAppearance(value)
  const set = <K extends keyof Appearance>(k: K, v: Appearance[K]) => onChange({ ...a, [k]: v })
  const [state, setState] = useState<AvatarState>('speaking')
  // A fake voice level so the preview moves like the real thing.
  const level = useRef(0)
  useEffect(() => {
    const t = setInterval(() => { level.current = state === 'listening' || state === 'speaking' ? 0.03 + Math.random() * 0.12 : 0 }, 120)
    return () => clearInterval(t)
  }, [state])
  const theme = THEMES[a.theme]

  return (
    <div className="space-y-5">
      <div className="flex flex-col items-center gap-3 rounded-xl p-5 text-white"
        style={{ background: `radial-gradient(110% 80% at 50% 30%, ${theme.from}55, transparent 65%), radial-gradient(120% 70% at 50% 110%, ${theme.to}66, transparent 70%), #0b1020` }}>
        <DbAvatar state={state} size={128} levelRef={level} look={a} />
        <div className="flex flex-wrap justify-center gap-1.5">
          {(['idle', 'listening', 'thinking', 'speaking'] as AvatarState[]).map((s) => (
            <button key={s} type="button" onClick={() => setState(s)}
              className={cn('rounded-full px-3 py-1 text-xs capitalize', state === s ? 'bg-white text-slate-900' : 'bg-white/15 text-white')}>{s}</button>
          ))}
        </div>
        <p className="text-xs text-white/70">Preview: tap a state to see how she looks.</p>
      </div>

      <div className="space-y-2">
        <Label className="text-xs">Colour theme</Label>
        <Swatches value={a.theme} onChange={(k) => set('theme', k)}
          items={Object.fromEntries(Object.entries(THEMES).map(([k, t]) => [k, { label: t.label, css: `linear-gradient(135deg, ${t.from}, ${t.to})` }])) as any} />
      </div>

      <div className="space-y-2">
        <Label className="text-xs">Her look</Label>
        <Choice name="avatar" value={a.avatar} onChange={(v) => set('avatar', v)} options={[
          ['face', 'Her face', 'An illustrated girl who blinks, listens and talks'],
          ['orb', 'Glowing orb', 'Like ChatGPT / Gemini voice modes'],
          ['initials', 'Initials', 'A calm “DB” badge'],
          ['photo', 'Your picture', 'A realistic look: a picture you upload'],
        ]} />
      </div>

      {a.avatar === 'photo' && onPhotoChange && <PhotoUpload version={photoVersion} onChange={onPhotoChange} />}

      {a.avatar === 'face' && (
        <div className="space-y-3 rounded-md bg-muted p-3">
          <div className="space-y-2">
            <Label className="text-xs">Outfit</Label>
            <Swatches value={a.outfit} onChange={(k) => set('outfit', k)}
              items={Object.fromEntries(Object.entries(OUTFITS).map(([k, o]) => [k, { label: o.label, css: o.color }])) as any} />
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Skin tone</Label>
            <Swatches value={a.skin} onChange={(k) => set('skin', k)}
              items={Object.fromEntries(Object.entries(SKINS).map(([k, s]) => [k, { label: s.label, css: s.face }])) as any} />
          </div>
          <div className="flex flex-wrap gap-5">
            <Toggle checked={a.bindi} onChange={(v) => set('bindi', v)} label="Bindi" />
            <Toggle checked={a.earrings} onChange={(v) => set('earrings', v)} label="Earrings" />
          </div>
        </div>
      )}

      <div className="space-y-2">
        <Label className="text-xs">While you talk to her</Label>
        <Choice name="voice_view" value={a.voice_view} onChange={(v) => set('voice_view', v)} options={[
          ['auto', 'Automatic (recommended)', 'Voice stage on your phone and the Fold, chat with live transcript on a laptop'],
          ['stage', 'Always the voice stage', 'Big avatar, captions and large buttons (like Gemini Live)'],
          ['chat', 'Always the chat', 'Live transcript in the conversation (like ChatGPT Voice)'],
        ]} />
        <Toggle checked={a.captions} onChange={(v) => set('captions', v)} label="Captions on the voice stage" hint="Shows what she is saying and what she heard from you." />
      </div>

      <div className="space-y-2">
        <Label className="text-xs">Feedback</Label>
        <div className="grid gap-2 sm:grid-cols-2">
          <Toggle checked={a.edge_glow} onChange={(v) => set('edge_glow', v)} label="Glowing screen edge" hint="The screen edge glows while she listens or speaks." />
          <Toggle checked={a.haptics} onChange={(v) => set('haptics', v)} label="Vibrate (Android)" hint="A short buzz when she starts listening or wakes up." />
          <Toggle checked={a.sounds} onChange={(v) => set('sounds', v)} label="Soft chimes" hint="When she starts listening and when she has heard you." />
          <Toggle checked={a.motion === 'reduced'} onChange={(v) => set('motion', v ? 'reduced' : 'full')} label="Reduce animations" hint="Calmer and lighter on the battery." />
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-xs">Chat</Label>
        <Choice name="text_size" value={a.text_size} onChange={(v) => set('text_size', v)} options={[
          ['sm', 'Small text'], ['md', 'Medium text'], ['lg', 'Large text'],
        ]} />
        <Choice name="bubbles" value={a.bubbles} onChange={(v) => set('bubbles', v)} options={[
          ['bubbles', 'Message bubbles'], ['minimal', 'Minimal (no bubbles)'],
        ]} />
        <Toggle checked={a.timestamps} onChange={(v) => set('timestamps', v)} label="Show message times" />
      </div>

      <div className="space-y-2">
        <Label className="text-xs">Where she sits</Label>
        <Choice name="wide_layout" value={a.wide_layout} onChange={(v) => set('wide_layout', v)} options={[
          ['split', 'Beside the ERP (split screen)', 'Fold opened / tablet: the page narrows and both stay usable'],
          ['float', 'Floating over the ERP', 'Fold opened / tablet: a card over the page; laptop still docks'],
        ]} />
        <p className="text-xs text-muted-foreground">On the Fold’s cover screen (and any phone) she always opens full screen. On a laptop she always sits beside the ERP.</p>
        <Choice name="panel_side" value={a.panel_side} onChange={(v) => set('panel_side', v)} options={[['right', 'Panel on the right'], ['left', 'Panel on the left']]} />
        <Choice name="panel_width" value={a.panel_width} onChange={(v) => set('panel_width', v)} options={[
          ['compact', 'Narrow panel'], ['regular', 'Regular panel'], ['wide', 'Wide panel'],
        ]} />
        <Choice name="launcher_side" value={a.launcher_side} onChange={(v) => set('launcher_side', v)} options={[['right', 'Her button bottom-right'], ['left', 'Her button bottom-left']]} />
        <Choice name="launcher_size" value={a.launcher_size} onChange={(v) => set('launcher_size', v)} options={[
          ['sm', 'Small button'], ['md', 'Medium button'], ['lg', 'Large button'],
        ]} />
      </div>
    </div>
  )
}
