'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Checkbox } from '@/components/ui/checkbox'

// On-screen keyboard that lights up each key as it's pressed. A browser can't
// see Fn (it never leaves the keyboard), and the Windows key / Print Screen
// are unreliable, so those are optional; the Fn combos are a separate
// question. Click a key on screen to mark it "not on this laptop".
//
// After every key is done, a 4-second "hands off" window catches stuck keys:
// any key event while nobody touches the keyboard means a key is stuck down.

type Key = { code: string; label: string; w?: number; optional?: boolean }

const ROWS_WINDOWS: Key[][] = [
  [{ code: 'Escape', label: 'Esc' }, ...Array.from({ length: 12 }, (_, i) => ({ code: `F${i + 1}`, label: `F${i + 1}` })),
    { code: 'Insert', label: 'Ins', optional: true }, { code: 'Delete', label: 'Del' }],
  [{ code: 'Backquote', label: '`' }, ...'1234567890'.split('').map((d) => ({ code: `Digit${d}`, label: d })),
    { code: 'Minus', label: '-' }, { code: 'Equal', label: '=' }, { code: 'Backspace', label: 'Backspace', w: 2 }],
  [{ code: 'Tab', label: 'Tab', w: 1.5 }, ...'QWERTYUIOP'.split('').map((c) => ({ code: `Key${c}`, label: c })),
    { code: 'BracketLeft', label: '[' }, { code: 'BracketRight', label: ']' }, { code: 'Backslash', label: '\\', w: 1.5 }],
  [{ code: 'CapsLock', label: 'Caps', w: 1.8 }, ...'ASDFGHJKL'.split('').map((c) => ({ code: `Key${c}`, label: c })),
    { code: 'Semicolon', label: ';' }, { code: 'Quote', label: "'" }, { code: 'Enter', label: 'Enter', w: 2.2 }],
  [{ code: 'ShiftLeft', label: 'Shift', w: 2.4 }, ...'ZXCVBNM'.split('').map((c) => ({ code: `Key${c}`, label: c })),
    { code: 'Comma', label: ',' }, { code: 'Period', label: '.' }, { code: 'Slash', label: '/' }, { code: 'ShiftRight', label: 'Shift', w: 2.6 }],
  [{ code: 'ControlLeft', label: 'Ctrl', w: 1.4 }, { code: 'MetaLeft', label: 'Win', optional: true }, { code: 'AltLeft', label: 'Alt' },
    { code: 'Space', label: 'Space', w: 5 }, { code: 'AltRight', label: 'Alt' }, { code: 'ContextMenu', label: 'Menu', optional: true },
    { code: 'ControlRight', label: 'Ctrl' }, { code: 'ArrowLeft', label: '←' }, { code: 'ArrowUp', label: '↑' }, { code: 'ArrowDown', label: '↓' },
    { code: 'ArrowRight', label: '→' }],
  [{ code: 'PrintScreen', label: 'PrtSc', optional: true }, { code: 'Home', label: 'Home', optional: true }, { code: 'End', label: 'End', optional: true },
    { code: 'PageUp', label: 'PgUp', optional: true }, { code: 'PageDown', label: 'PgDn', optional: true }],
]

// MacBook keyboard (US/Indian layout). fn never reaches a browser, so it is
// optional here and covered by the guided Fn-keys item. With a Touch Bar the
// F-keys are virtual (shown when fn is held) and are tested on the Touch Bar step.
function macRows(fnKeysOptional: boolean): Key[][] {
  return [
    [{ code: 'Escape', label: 'esc' }, ...Array.from({ length: 12 }, (_, i) => ({ code: `F${i + 1}`, label: `F${i + 1}`, optional: fnKeysOptional }))],
    [{ code: 'Backquote', label: '`' }, ...'1234567890'.split('').map((d) => ({ code: `Digit${d}`, label: d })),
      { code: 'Minus', label: '-' }, { code: 'Equal', label: '=' }, { code: 'Backspace', label: 'delete', w: 2 }],
    [{ code: 'Tab', label: 'tab', w: 1.5 }, ...'QWERTYUIOP'.split('').map((c) => ({ code: `Key${c}`, label: c })),
      { code: 'BracketLeft', label: '[' }, { code: 'BracketRight', label: ']' }, { code: 'Backslash', label: '\\', w: 1.5 }],
    [{ code: 'CapsLock', label: 'caps lock', w: 1.8 }, ...'ASDFGHJKL'.split('').map((c) => ({ code: `Key${c}`, label: c })),
      { code: 'Semicolon', label: ';' }, { code: 'Quote', label: "'" }, { code: 'Enter', label: 'return', w: 2.2 }],
    [{ code: 'ShiftLeft', label: 'shift', w: 2.4 }, { code: 'IntlBackslash', label: '§', optional: true }, ...'ZXCVBNM'.split('').map((c) => ({ code: `Key${c}`, label: c })),
      { code: 'Comma', label: ',' }, { code: 'Period', label: '.' }, { code: 'Slash', label: '/' }, { code: 'ShiftRight', label: 'shift', w: 2.6 }],
    [{ code: 'Fn', label: 'fn', optional: true }, { code: 'ControlLeft', label: 'control', w: 1.2 }, { code: 'AltLeft', label: 'option', w: 1.2 },
      { code: 'MetaLeft', label: 'command', w: 1.5 }, { code: 'Space', label: 'space', w: 5 }, { code: 'MetaRight', label: 'command', w: 1.5 },
      { code: 'AltRight', label: 'option', w: 1.2 }, { code: 'ArrowLeft', label: '←' }, { code: 'ArrowUp', label: '↑' }, { code: 'ArrowDown', label: '↓' },
      { code: 'ArrowRight', label: '→' }],
  ]
}

const NUMPAD: Key[] = ['NumLock', 'NumpadDivide', 'NumpadMultiply', 'NumpadSubtract', 'Numpad7', 'Numpad8', 'Numpad9', 'NumpadAdd',
  'Numpad4', 'Numpad5', 'Numpad6', 'Numpad1', 'Numpad2', 'Numpad3', 'NumpadEnter', 'Numpad0', 'NumpadDecimal']
  .map((code) => ({ code, label: code.replace('Numpad', '').replace('Divide', '/').replace('Multiply', '*').replace('Subtract', '-').replace('Add', '+').replace('Decimal', '.').replace('NumLock', 'Num') }))

export interface KeyboardResult { allPressed: boolean; missing: string[]; notOnLaptop: string[]; stuck: string | null }

export function KeyboardTest({ onResult, layout = 'windows', fnKeysOptional = false }: {
  onResult: (r: KeyboardResult) => void
  layout?: 'windows' | 'mac'
  /** Mac with a Touch Bar: F1-F12 are on the bar, not keys. */
  fnKeysOptional?: boolean
}) {
  const ROWS = useMemo(() => (layout === 'mac' ? macRows(fnKeysOptional) : ROWS_WINDOWS), [layout, fnKeysOptional])
  const [pressed, setPressed] = useState<Set<string>>(new Set())
  const [notHere, setNotHere] = useState<Set<string>>(new Set())
  const [hasNumpad, setHasNumpad] = useState(false)
  const [extra, setExtra] = useState<string[]>([])
  const [phase, setPhase] = useState<'typing' | 'handsoff' | 'done'>('typing')
  const [countdown, setCountdown] = useState(4)
  const stuckRef = useRef<string | null>(null)

  const required = useMemo(() => {
    const keys = ROWS.flat().filter((k) => !k.optional).map((k) => k.code)
    if (hasNumpad) keys.push(...NUMPAD.map((k) => k.code))
    return keys.filter((c) => !notHere.has(c))
  }, [hasNumpad, notHere, ROWS])
  const missing = required.filter((c) => !pressed.has(c))

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      e.preventDefault()
      if (phase === 'handsoff') { stuckRef.current = e.code || e.key; return }
      if (phase !== 'typing') return
      const code = e.code || e.key
      setPressed((p) => (p.has(code) ? p : new Set(p).add(code)))
      const known = ROWS.flat().some((k) => k.code === code) || NUMPAD.some((k) => k.code === code)
      if (!known) setExtra((x) => (x.includes(code) ? x : [...x, code].slice(-12)))
    }
    // Print Screen only fires keyup in most browsers.
    const up = (e: KeyboardEvent) => {
      if (phase === 'typing' && e.code === 'PrintScreen') setPressed((p) => new Set(p).add('PrintScreen'))
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
  }, [phase, ROWS])

  useEffect(() => {
    if (phase !== 'handsoff') return
    if (countdown <= 0) {
      setPhase('done')
      onResult({ allPressed: missing.length === 0, missing, notOnLaptop: Array.from(notHere), stuck: stuckRef.current })
      return
    }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, countdown])

  const keyEl = (k: Key) => {
    const on = pressed.has(k.code)
    const na = notHere.has(k.code)
    return (
      <button
        type="button"
        key={k.code}
        title={na ? 'Marked as not on this laptop (click to undo)' : 'Click if this laptop has no such key'}
        onClick={() => setNotHere((s) => { const n = new Set(s); if (n.has(k.code)) n.delete(k.code); else n.add(k.code); return n })}
        style={{ flex: `${k.w || 1} 1 0` }}
        className={`h-9 min-w-0 rounded border text-[11px] font-medium truncate px-0.5 ${
          on ? 'bg-success text-success-foreground border-success' : na ? 'bg-muted text-muted-foreground line-through' : k.optional ? 'bg-card border-dashed' : 'bg-card'
        }`}
      >
        {k.label}
      </button>
    )
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border bg-muted/40 p-2 space-y-1">
        {ROWS.map((row, i) => <div key={i} className="flex gap-1">{row.map(keyEl)}</div>)}
        {hasNumpad && <div className="flex gap-1 flex-wrap pt-2">{NUMPAD.map((k) => <div key={k.code} className="w-12">{keyEl(k)}</div>)}</div>}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <span className={missing.length ? 'text-muted-foreground' : 'text-success font-semibold'}>
          {missing.length ? `${missing.length} keys still to press` : 'Every key pressed ✓'}
        </span>
        {layout === 'windows' && (
          <label className="flex items-center gap-2">
            <Checkbox checked={hasNumpad} onCheckedChange={(v) => setHasNumpad(!!v)} /> This laptop has a number pad
          </label>
        )}
        {extra.length > 0 && <span className="text-muted-foreground">Other keys seen: {extra.join(', ')}</span>}
      </div>
      <p className="text-xs text-muted-foreground">
        {layout === 'mac'
          ? <>Dashed keys are optional. Hold <b>fn</b> while pressing F1–F12. Press <b>command</b> on its own — command with another key can close the browser. Click a key on screen if this Mac doesn&apos;t have it.</>
          : <>Dashed keys are optional. If an F-key changes volume or brightness instead, hold Fn while pressing it. Click a key on screen if this laptop doesn&apos;t have it.</>}
      </p>
      {phase === 'typing' && (
        <button
          type="button"
          disabled={missing.length > 0}
          onClick={() => { stuckRef.current = null; setCountdown(4); setPhase('handsoff') }}
          className="rounded-lg bg-primary text-primary-foreground px-4 py-3 font-semibold disabled:opacity-40"
        >
          Done — check for stuck keys
        </button>
      )}
      {phase === 'handsoff' && (
        <div className="rounded-lg border border-warning bg-warning/10 p-3 font-semibold">Hands OFF the keyboard… {countdown}</div>
      )}
      {phase === 'done' && (
        <button type="button" onClick={() => { setPressed(new Set()); setPhase('typing') }} className="text-sm underline text-muted-foreground">
          Test the keyboard again
        </button>
      )}
    </div>
  )
}
