'use client'

import { useEffect, useState } from 'react'
import { SimpleModal } from '@/components/SimpleModal'
import { ErrorBanner } from '@/components/ErrorBanner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { apiFetch } from '@/lib/api-client'
import { useAsyncAction } from '@/lib/useAsyncAction'
import { LEAVE_TYPE_LABELS } from '@/lib/attendance'
import type { LeaveRow } from '@/components/attendance/LeaveRequestsTable'
import { Loader2 } from 'lucide-react'

// Approve or reject. Both go through the same /decide endpoint, which wraps
// decide_leave_request() -- a double-click or two managers racing can only ever
// produce one decision, and the loser gets a 409 shown here rather than a
// silent second approval.
export function ApproveLeaveDialog({
  row, isOpen, onClose, onSaved,
}: {
  row: LeaveRow | null
  isOpen: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  useEffect(() => { if (isOpen) { setNote(''); setError('') } }, [isOpen])

  const decide = useAsyncAction(async (decision: 'approved' | 'rejected') => {
    if (!row) return
    setError('')
    const res = await apiFetch(`/api/leave-requests/${row.id}/decide`, {
      method: 'POST',
      body: JSON.stringify({ decision, note: note.trim() || null }),
    })
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || 'Could not record that decision.')
      return
    }
    onSaved()
    onClose()
  })

  if (!row) return null

  return (
    <SimpleModal isOpen={isOpen} onClose={onClose} title="Decide leave request" closeOnBackdropClick={false}>
      <div className="space-y-3">
        {error && <ErrorBanner message={error} />}

        <div className="rounded-md border border-border p-3 text-sm space-y-1">
          <div className="font-medium">{row.staff?.full_name ?? '--'}</div>
          <div className="text-muted-foreground tabular-nums">
            {row.from_date === row.to_date ? row.from_date : `${row.from_date} to ${row.to_date}`}
            {row.day_part !== 'full' && ` (${row.day_part.replace('_', ' ')})`}
          </div>
          <div className="text-muted-foreground">
            {LEAVE_TYPE_LABELS[row.leave_type] ?? row.leave_type}
          </div>
          {row.reason && <div className="text-muted-foreground">Reason: {row.reason}</div>}
        </div>

        <div>
          <label className="text-sm font-medium block mb-1">Note</label>
          <Input value={note} onChange={e => setNote(e.target.value)} className="h-8" placeholder="Optional" />
        </div>

        <p className="text-xs text-muted-foreground">
          Approving writes these days onto the register as leave, skipping weekly offs and shop
          holidays. A day a supervisor has already marked by hand is left as it is.
        </p>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button
            variant="outline" size="sm"
            className="text-destructive border-destructive/40"
            disabled={decide.pending}
            onClick={() => decide.run('rejected')}
          >
            Reject
          </Button>
          <Button size="sm" disabled={decide.pending} onClick={() => decide.run('approved')}>
            {decide.pending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
            Approve
          </Button>
        </div>
      </div>
    </SimpleModal>
  )
}
