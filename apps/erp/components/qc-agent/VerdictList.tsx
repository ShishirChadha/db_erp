'use client'

import { Loader2, AlertTriangle, CheckCircle2, XCircle, HelpCircle, MinusCircle } from 'lucide-react'
import type { Verdict } from '@/lib/qc-agent/rules'

// The QC list on the Auto Check review screen, grouped by area. Each row shows
// what the script / test page decided and lets the engineer settle it.
// Nothing here is pre-filled as pass unless the check itself passed, and a
// hard fail can only be turned into a pass with a written reason.

export interface Decision { result: 'pass' | 'fail' | 'na'; note?: string; reason?: string }

const SETTLED = new Set(['pass', 'fail', 'na'])

/** What will be saved for a check, or null if the engineer still has to decide. */
export function effectiveDecision(v: Verdict, override: Decision | undefined): Decision | null {
  if (v.state === 'pending') return null
  if (override) return override
  if (SETTLED.has(v.state)) return { result: v.state as Decision['result'], note: v.note }
  return null
}

/** An override of a hard fail to pass needs a reason of a few words. */
export function overrideMissingReason(v: Verdict, d: Decision | null) {
  return !!(d && v.hard && v.state === 'fail' && d.result === 'pass' && (d.reason || '').trim().length < 8)
}

/** The note saved into asset_qc_checks for this row. */
export function savedNote(v: Verdict, d: Decision): string {
  if (v.hard && v.state === 'fail' && d.result === 'pass') return `OVERRIDE by engineer: ${d.reason?.trim()} (auto: ${v.note})`
  if (d.note && d.note !== v.note) return v.note ? `${d.note} (auto: ${v.note})` : d.note
  return d.note || v.note || ''
}

const STATE_UI: Record<string, { icon: React.ReactNode; text: string; tone: string }> = {
  pass: { icon: <CheckCircle2 className="size-4" />, text: 'Pass', tone: 'text-success' },
  fail: { icon: <XCircle className="size-4" />, text: 'Fail', tone: 'text-destructive' },
  na: { icon: <MinusCircle className="size-4" />, text: 'N/A', tone: 'text-muted-foreground' },
  warn: { icon: <AlertTriangle className="size-4" />, text: 'Check this', tone: 'text-warning' },
  unknown: { icon: <HelpCircle className="size-4" />, text: 'Couldn\'t check', tone: 'text-warning' },
  missing: { icon: <HelpCircle className="size-4" />, text: 'Not answered', tone: 'text-warning' },
  pending: { icon: <Loader2 className="size-4 animate-spin" />, text: 'Running', tone: 'text-muted-foreground' },
}

function Row({ v, override, onChange }: { v: Verdict; override?: Decision; onChange: (d: Decision | null) => void }) {
  const eff = effectiveDecision(v, override)
  const ui = STATE_UI[v.state]
  const seg = (result: Decision['result'], label: string, tone: string) => (
    <button
      type="button"
      disabled={v.state === 'pending'}
      onClick={() => {
        if (override?.result === result) { onChange(null); return }
        onChange({ result, note: override?.note, reason: override?.reason })
      }}
      className={`px-3 h-8 text-xs font-semibold border first:rounded-l-md last:rounded-r-md -ml-px first:ml-0 disabled:opacity-40 ${
        eff?.result === result ? tone : 'bg-card hover:bg-muted'
      }`}
    >
      {label}
    </button>
  )
  const needsReason = overrideMissingReason(v, eff)
  return (
    <div className={`py-2.5 border-b last:border-b-0 ${eff ? '' : 'bg-warning/5 -mx-3 px-3'}`}>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="flex-1 min-w-[12rem]">
          <div className="flex items-center gap-2 text-sm font-medium">
            <span className={ui.tone}>{ui.icon}</span>
            {v.label}
            <span className={`text-xs font-normal ${ui.tone}`}>{v.kind === 'auto' ? `Auto · ${ui.text}` : ui.text}</span>
          </div>
          {v.note && <div className="text-xs text-muted-foreground mt-0.5 ml-6">{v.note}</div>}
        </div>
        <div className="flex shrink-0">
          {seg('pass', 'Pass', 'bg-success text-success-foreground border-success')}
          {seg('fail', 'Fail', 'bg-destructive text-destructive-foreground border-destructive')}
          {(v.naLabel || v.state === 'na' || v.key.startsWith('tpl:')) && seg('na', 'N/A', 'bg-foreground text-background border-foreground')}
        </div>
      </div>
      {override && (override.result === 'fail' || needsReason || (v.hard && v.state === 'fail' && override.result === 'pass')) && (
        <input
          value={(v.hard && v.state === 'fail' && override.result === 'pass' ? override.reason : override.note) || ''}
          onChange={(e) => onChange(
            v.hard && v.state === 'fail' && override.result === 'pass'
              ? { ...override, reason: e.target.value }
              : { ...override, note: e.target.value },
          )}
          placeholder={v.hard && v.state === 'fail' && override.result === 'pass' ? 'Why is this OK? (required to override a fail)' : 'What is wrong?'}
          className={`mt-2 ml-6 w-[calc(100%-1.5rem)] border rounded-md px-2 h-8 text-sm bg-background ${needsReason ? 'border-destructive' : ''}`}
        />
      )}
    </div>
  )
}

export function VerdictList({
  verdicts,
  overrides,
  onChange,
}: {
  verdicts: Verdict[]
  overrides: Record<string, Decision>
  onChange: (key: string, d: Decision | null) => void
}) {
  const areas: string[] = []
  for (const v of verdicts) if (!areas.includes(v.area)) areas.push(v.area)
  return (
    <div className="space-y-4">
      {areas.map((area) => (
        <div key={area} className="rounded-md border bg-card px-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground pt-3 pb-1">{area}</div>
          {verdicts.filter((v) => v.area === area).map((v) => (
            <Row key={v.key} v={v} override={overrides[v.key]} onChange={(d) => onChange(v.key, d)} />
          ))}
        </div>
      ))}
    </div>
  )
}
