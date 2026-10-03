'use client'

import { useState } from 'react'
import { apiFetch } from '@/lib/api-client'
import { useAsyncAction } from '@/lib/useAsyncAction'
import { useMyAttendance } from '@/lib/useMyAttendance'
import { formatMinutes } from '@/lib/attendance'
import { LogIn, LogOut, Loader2, WifiOff } from 'lucide-react'
import { cn } from '@/lib/utils'

function istTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

// Self-service punch in / punch out.
//
// Placement is the whole requirement: this is mounted in the mobile top bar
// (components/sidebar.tsx), which renders on every dashboard page on a phone,
// so punching is one tap from wherever the user already is. It needs no page
// grant -- see app/api/attendance/me/route.ts.
//
// Renders NOTHING when the signed-in user has no roster row, so the module is
// invisible to owner-only logins and to staff not yet added. That is why there
// is no empty state and no configuration here.
export function PunchWidget({ compact = false, className }: { compact?: boolean; className?: string }) {
  const { data, loading, applyPunchResult, refresh } = useMyAttendance()
  const [error, setError] = useState('')
  const [offNetwork, setOffNetwork] = useState(false)

  const punch = useAsyncAction(async (type: 'in' | 'out') => {
    setError('')
    setOffNetwork(false)
    const res = await apiFetch('/api/attendance/punch', {
      method: 'POST',
      body: JSON.stringify({ type }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      // Being on mobile data is an expected state, not a failure -- shown as a
      // quiet line rather than a red error banner.
      if (json.code === 'off_network') {
        setOffNetwork(true)
        setError(json.error || 'Punch in from the shop wifi.')
      } else {
        setError(json.error || 'Could not record that punch.')
      }
      // The open-punch state may have moved under us (another device, a
      // supervisor correction), so resync rather than leave a stale button.
      await refresh()
      return
    }
    applyPunchResult(json.day ?? null, type === 'in' ? { id: json.punch.id, punched_at: json.punch.punched_at, work_date: json.punch.work_date } : null)
  })

  if (loading && !data) {
    return compact ? null : (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading...
      </div>
    )
  }
  if (!data?.staff) return null

  const open = data.open_punch
  const today = data.today
  const isIn = !!open

  const button = (
    <button
      type="button"
      onClick={() => punch.run(isIn ? 'out' : 'in')}
      disabled={punch.pending}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:opacity-60',
        compact ? 'h-8 px-2.5 text-xs' : 'h-10 px-4 text-sm w-full sm:w-auto',
        isIn
          ? 'bg-warning/15 text-warning hover:bg-warning/25'
          : 'bg-success/15 text-success hover:bg-success/25',
      )}
    >
      {punch.pending
        ? <Loader2 className={compact ? 'h-3.5 w-3.5 animate-spin' : 'h-4 w-4 animate-spin'} />
        : isIn
          ? <LogOut className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
          : <LogIn className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />}
      {isIn ? 'Punch Out' : 'Punch In'}
      {isIn && !compact && open && (
        <span className="font-normal opacity-80">· in since {istTime(open.punched_at)}</span>
      )}
    </button>
  )

  if (compact) {
    return (
      <div className={cn('flex items-center gap-1.5', className)}>
        {button}
        {offNetwork && (
          <span title={error} className="inline-flex">
            <WifiOff className="h-3.5 w-3.5 text-muted-foreground" />
          </span>
        )}
      </div>
    )
  }

  return (
    <div className={cn('rounded-md border border-border p-3 space-y-2', className)}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{data.staff.full_name}</div>
          <div className="text-xs text-muted-foreground">
            {data.staff.shift
              ? `${data.staff.shift.name} · ${data.staff.shift.start_time.slice(0, 5)}-${data.staff.shift.end_time.slice(0, 5)}`
              : 'No shift assigned'}
          </div>
        </div>
        {button}
      </div>

      {today && (
        <div className="text-xs text-muted-foreground tabular-nums">
          {isIn ? 'In since ' : 'Today: '}
          {isIn && open
            ? istTime(open.punched_at)
            : today.first_in_at
              ? `${istTime(today.first_in_at)}${today.last_out_at ? ` - ${istTime(today.last_out_at)}` : ''} · ${formatMinutes(today.worked_minutes)}`
              : 'not punched in yet'}
          {today.is_late && today.late_minutes > 0 && (
            <span className="text-warning"> · {formatMinutes(today.late_minutes)} late</span>
          )}
        </div>
      )}

      {error && (
        <div className={cn('text-xs flex items-start gap-1.5', offNetwork ? 'text-muted-foreground' : 'text-destructive')}>
          {offNetwork && <WifiOff className="h-3.5 w-3.5 mt-0.5 shrink-0" />}
          <span>{error}</span>
        </div>
      )}
    </div>
  )
}
