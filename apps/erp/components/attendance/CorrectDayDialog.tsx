'use client'

import { useCallback, useEffect, useState } from 'react'
import { SimpleModal } from '@/components/SimpleModal'
import { ErrorBanner } from '@/components/ErrorBanner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { apiFetch } from '@/lib/api-client'
import { useAsyncAction } from '@/lib/useAsyncAction'
import { ATTENDANCE_STATUSES, formatMinutes } from '@/lib/attendance'
import { StatusBadge } from '@/components/StatusBadge'
import { ATTENDANCE_STATUS_TONES, toneFor } from '@/lib/status-styles'
import type { RegisterRow } from '@/components/attendance/DayRegister'
import { Loader2, Ban } from 'lucide-react'

interface PunchRow {
  id: string
  punch_type: 'in' | 'out'
  punched_at: string
  source: string
  reason: string | null
  note: string | null
  client_ip: string | null
  ip_check: string | null
  voided_at: string | null
  void_reason: string | null
}

function istTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

// Correct one staff member's day.
//
// Three things happen here, and they are deliberately distinct:
//   - override the day's STATUS (sticky: status_source becomes 'manual', so no
//     later punch or nightly scan can undo it)
//   - revert that override, handing the day back to the punch log
//   - void an individual PUNCH, which never deletes it -- the original tap
//     stays on the record, struck through, forever
export function CorrectDayDialog({
  row, date, isOpen, onClose, onSaved,
}: {
  row: RegisterRow | null
  date: string
  isOpen: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const [punches, setPunches] = useState<PunchRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState<string>('')
  const [reason, setReason] = useState('')

  const loadPunches = useCallback(async () => {
    if (!row) return
    setLoading(true)
    const res = await apiFetch(`/api/attendance/punches?staff_id=${row.staff.id}&work_date=${date}`)
    setPunches(res.ok ? await res.json() : [])
    setLoading(false)
  }, [row, date])

  useEffect(() => {
    if (!isOpen) return
    setError('')
    setReason('')
    setStatus(row?.day?.status ?? '')
    loadPunches()
  }, [isOpen, row, loadPunches])

  const save = useAsyncAction(async () => {
    if (!row?.day) {
      setError('This day has no record yet -- add a punch for this person first.')
      return
    }
    if (!reason.trim()) {
      setError('A reason is required when overriding attendance.')
      return
    }
    setError('')
    const res = await apiFetch(`/api/attendance/${row.day.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status, reason: reason.trim() }),
    })
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || 'Could not save that correction.')
      return
    }
    onSaved()
    onClose()
  })

  const revert = useAsyncAction(async () => {
    if (!row?.day) return
    setError('')
    const res = await apiFetch(`/api/attendance/${row.day.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: null, reason: reason.trim() || null }),
    })
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || 'Could not revert.')
      return
    }
    onSaved()
    onClose()
  })

  const voidPunch = useAsyncAction(async (punchId: string) => {
    const why = reason.trim()
    if (!why) {
      setError('Type a reason above before voiding a punch.')
      return
    }
    setError('')
    const res = await apiFetch(`/api/attendance/punches/${punchId}/void`, {
      method: 'POST',
      body: JSON.stringify({ reason: why }),
    })
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || 'Could not void that punch.')
      return
    }
    await loadPunches()
    onSaved()
  })

  if (!row) return null

  return (
    <SimpleModal
      isOpen={isOpen}
      onClose={onClose}
      title={`${row.staff.full_name} — ${date}`}
      wide
      closeOnBackdropClick={false}
    >
      <div className="space-y-4">
        {error && <ErrorBanner message={error} />}

        {/* Derived facts, for context. These keep updating from the punch log
            even after a manual override, which is why they are shown
            separately from the status. */}
        {row.day && (
          <div className="rounded-md border border-border p-3 text-xs text-muted-foreground space-y-1">
            <div className="flex items-center gap-2">
              <span>Currently</span>
              <StatusBadge tone={toneFor(ATTENDANCE_STATUS_TONES, row.day.status)}>
                {row.day.status.replace(/_/g, ' ')}
              </StatusBadge>
              <span>via {row.day.status_source}</span>
            </div>
            <div className="tabular-nums">
              Worked {formatMinutes(row.day.worked_minutes)}
              {row.day.late_minutes > 0 && ` · ${formatMinutes(row.day.late_minutes)} late`}
              {row.day.overtime_minutes > 0 && ` · ${formatMinutes(row.day.overtime_minutes)} overtime`}
            </div>
            {row.day.override_reason && <div>Override reason: {row.day.override_reason}</div>}
          </div>
        )}

        {/* The punch log, voided rows included -- an append-only ledger is only
            useful if the UI can show what was originally recorded. */}
        <div>
          <div className="text-sm font-medium mb-1.5">Punch log</div>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading...
            </div>
          ) : punches.length === 0 ? (
            <p className="text-sm text-muted-foreground">No punches recorded for this day.</p>
          ) : (
            <div className="rounded-md border border-border divide-y divide-border">
              {punches.map(p => (
                <div key={p.id} className="flex items-center justify-between gap-2 p-2 text-sm">
                  <div className={p.voided_at ? 'line-through text-muted-foreground' : ''}>
                    <span className="font-medium capitalize">{p.punch_type}</span>
                    <span className="tabular-nums ml-2">{istTime(p.punched_at)}</span>
                    <span className="text-xs text-muted-foreground ml-2">
                      {p.source}
                      {p.ip_check === 'not_enforced' && ' · ip not checked'}
                      {p.client_ip && ` · ${p.client_ip}`}
                    </span>
                    {p.voided_at && p.void_reason && (
                      <div className="text-xs text-muted-foreground">voided: {p.void_reason}</div>
                    )}
                  </div>
                  {!p.voided_at && (
                    <Button
                      variant="ghost" size="sm" className="h-8 px-2 text-destructive shrink-0"
                      disabled={voidPunch.pending}
                      onClick={() => voidPunch.run(p.id)}
                    >
                      <Ban className="h-3.5 w-3.5 mr-1" /> Void
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Reason first: it gates every action below it, including voiding a
            punch, so it belongs above them rather than at the bottom. */}
        <div>
          <label className="text-sm font-medium block mb-1">Reason <span className="text-destructive">*</span></label>
          <Input
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Why is this being changed?"
            className="h-8"
          />
        </div>

        <div>
          <label className="text-sm font-medium block mb-1">Set status</label>
          <select
            value={status}
            onChange={e => setStatus(e.target.value)}
            className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="">-- choose --</option>
            {ATTENDANCE_STATUSES.map(s => (
              <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground mt-1">
            A manual status sticks: later punches and the nightly scan will not change it,
            though the worked/late figures above keep updating.
          </p>
        </div>

        <div className="flex flex-wrap justify-end gap-2 pt-2">
          {row.day?.status_source !== 'derived' && row.day && (
            <Button variant="outline" size="sm" disabled={revert.pending} onClick={() => revert.run()}>
              {revert.pending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
              Revert to punch log
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={save.pending || !status} onClick={() => save.run()}>
            {save.pending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
            Save correction
          </Button>
        </div>
      </div>
    </SimpleModal>
  )
}
