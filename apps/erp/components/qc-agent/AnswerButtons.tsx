'use client'

import { useState } from 'react'
import { Check, X, Minus } from 'lucide-react'
import type { GuidedAnswer } from '@/lib/qc-agent/types'

// One guided check: Works / Problem (/ not present). Problem asks for a short
// note so the review screen and the unit's QC record say what was wrong.
export function AnswerButtons({
  label,
  hint,
  value,
  onAnswer,
  naLabel,
  passLabel = 'Works',
  failLabel = 'Problem',
  passDisabled,
}: {
  label: string
  hint?: string
  value?: GuidedAnswer
  onAnswer: (a: GuidedAnswer) => void
  naLabel?: string
  passLabel?: string
  failLabel?: string
  passDisabled?: boolean
}) {
  const [noteOpen, setNoteOpen] = useState(false)
  const [note, setNote] = useState(value?.result === 'fail' ? value.note || '' : '')

  const btn = (active: boolean, tone: string) =>
    `flex-1 min-w-[7rem] inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-3 text-sm font-semibold transition-colors disabled:opacity-40 ${
      active ? tone : 'bg-card hover:bg-muted'
    }`

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="font-medium">{label}</div>
      {hint && <div className="text-sm text-muted-foreground mt-0.5">{hint}</div>}
      <div className="flex flex-wrap gap-2 mt-3">
        <button
          type="button"
          disabled={passDisabled}
          onClick={() => { setNoteOpen(false); onAnswer({ result: 'pass' }) }}
          className={btn(value?.result === 'pass', 'bg-success text-success-foreground border-success')}
        >
          <Check className="size-4" /> {passLabel}
        </button>
        <button
          type="button"
          onClick={() => setNoteOpen(true)}
          className={btn(value?.result === 'fail', 'bg-destructive text-destructive-foreground border-destructive')}
        >
          <X className="size-4" /> {failLabel}
        </button>
        {naLabel && (
          <button
            type="button"
            onClick={() => { setNoteOpen(false); onAnswer({ result: 'na', note: naLabel }) }}
            className={btn(value?.result === 'na', 'bg-foreground text-background border-foreground')}
          >
            <Minus className="size-4" /> {naLabel}
          </button>
        )}
      </div>
      {noteOpen && (
        <div className="mt-3 flex gap-2">
          <input
            autoFocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { onAnswer({ result: 'fail', note: note.trim() || undefined }); setNoteOpen(false) } }}
            placeholder="What's wrong? (e.g. left speaker crackles)"
            className="flex-1 border rounded-lg px-3 py-2 text-sm bg-background"
          />
          <button
            type="button"
            onClick={() => { onAnswer({ result: 'fail', note: note.trim() || undefined }); setNoteOpen(false) }}
            className="rounded-lg bg-destructive text-destructive-foreground px-4 text-sm font-semibold"
          >
            Save
          </button>
        </div>
      )}
      {value?.result === 'fail' && value.note && !noteOpen && (
        <div className="text-sm text-destructive mt-2">Problem: {value.note}</div>
      )}
    </div>
  )
}
