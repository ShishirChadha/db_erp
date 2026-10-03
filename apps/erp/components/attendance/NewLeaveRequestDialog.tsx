'use client'

import { useEffect, useState } from 'react'
import { SimpleModal } from '@/components/SimpleModal'
import { ErrorBanner } from '@/components/ErrorBanner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { apiFetch } from '@/lib/api-client'
import { useAsyncAction } from '@/lib/useAsyncAction'
import { LEAVE_TYPES, LEAVE_TYPE_LABELS, DAY_PARTS, istToday } from '@/lib/attendance'
import { Loader2 } from 'lucide-react'

interface StaffOption { id: string; full_name: string }

// File a leave request.
//
// `canFileForOthers` reflects the attendance edit grant, and it is the ONLY way
// an account-less staff member's leave gets recorded -- they have no login to
// file it themselves. When false the dialog files the signed-in user's own
// leave and shows no staff picker at all.
export function NewLeaveRequestDialog({
  isOpen, onClose, onSaved, canFileForOthers,
}: {
  isOpen: boolean
  onClose: () => void
  onSaved: () => void
  canFileForOthers: boolean
}) {
  const [staff, setStaff] = useState<StaffOption[]>([])
  const [staffId, setStaffId] = useState('')
  const [leaveType, setLeaveType] = useState<string>('casual')
  const [fromDate, setFromDate] = useState(istToday())
  const [toDate, setToDate] = useState(istToday())
  const [dayPart, setDayPart] = useState('full')
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isOpen) return
    setError('')
    setReason('')
    setDayPart('full')
    setFromDate(istToday())
    setToDate(istToday())
    setStaffId('')
    if (canFileForOthers) {
      apiFetch('/api/staff?active=true').then(async res => {
        if (res.ok) setStaff(await res.json())
      })
    }
  }, [isOpen, canFileForOthers])

  const submit = useAsyncAction(async () => {
    setError('')
    const body: Record<string, unknown> = {
      leave_type: leaveType,
      from_date: fromDate,
      to_date: dayPart === 'full' ? toDate : fromDate,
      day_part: dayPart,
      reason: reason.trim() || null,
    }
    if (canFileForOthers && staffId) body.staff_id = staffId

    const res = await apiFetch('/api/leave-requests', { method: 'POST', body: JSON.stringify(body) })
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || 'Could not file that request.')
      return
    }
    onSaved()
    onClose()
  })

  return (
    <SimpleModal isOpen={isOpen} onClose={onClose} title="Apply for leave" closeOnBackdropClick={false}>
      <div className="space-y-3">
        {error && <ErrorBanner message={error} />}

        {canFileForOthers && (
          <div>
            <label className="text-sm font-medium block mb-1">Staff member</label>
            <select
              value={staffId}
              onChange={e => setStaffId(e.target.value)}
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="">Myself</option>
              {staff.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
            </select>
          </div>
        )}

        <div>
          <label className="text-sm font-medium block mb-1">Leave type</label>
          <select
            value={leaveType}
            onChange={e => setLeaveType(e.target.value)}
            className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
          >
            {LEAVE_TYPES.map(t => <option key={t} value={t}>{LEAVE_TYPE_LABELS[t]}</option>)}
          </select>
        </div>

        <div>
          <label className="text-sm font-medium block mb-1">Duration</label>
          <select
            value={dayPart}
            onChange={e => setDayPart(e.target.value)}
            className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
          >
            {DAY_PARTS.map(d => (
              <option key={d} value={d}>
                {d === 'full' ? 'Full day(s)' : d.replace('_', ' ') + ' only'}
              </option>
            ))}
          </select>
          {dayPart !== 'full' && (
            <p className="text-xs text-muted-foreground mt-1">A half-day leave must be a single day.</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-sm font-medium block mb-1">From</label>
            <Input type="date" value={fromDate} className="h-8"
              onChange={e => {
                setFromDate(e.target.value)
                if (e.target.value > toDate) setToDate(e.target.value)
              }} />
          </div>
          <div>
            <label className="text-sm font-medium block mb-1">To</label>
            <Input type="date" value={dayPart === 'full' ? toDate : fromDate} min={fromDate} className="h-8"
              disabled={dayPart !== 'full'}
              onChange={e => setToDate(e.target.value)} />
          </div>
        </div>

        <div>
          <label className="text-sm font-medium block mb-1">Reason</label>
          <Input value={reason} onChange={e => setReason(e.target.value)} className="h-8" placeholder="Optional" />
        </div>

        <p className="text-xs text-muted-foreground">
          Weekly offs and shop holidays inside the range are not counted as leave.
        </p>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={submit.pending} onClick={() => submit.run()}>
            {submit.pending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
            Submit request
          </Button>
        </div>
      </div>
    </SimpleModal>
  )
}
