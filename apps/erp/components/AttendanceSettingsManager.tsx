'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api-client'
import { useAsyncAction } from '@/lib/useAsyncAction'
import { ErrorBanner } from '@/components/ErrorBanner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { istToday } from '@/lib/attendance'
import { Loader2, Trash2, Plus, AlertTriangle } from 'lucide-react'

type Section = 'shifts' | 'roster' | 'networks' | 'holidays'

const SECTIONS: { key: Section; label: string }[] = [
  { key: 'shifts', label: 'Shifts' },
  { key: 'roster', label: 'Staff roster' },
  { key: 'networks', label: 'Office networks' },
  { key: 'holidays', label: 'Shop holidays' },
]

// ISO day-of-week: 1 = Monday .. 7 = Sunday, matching extract(isodow) in
// scan_attendance_days() and decide_leave_request().
const DOW = [
  { n: 1, label: 'Mon' }, { n: 2, label: 'Tue' }, { n: 3, label: 'Wed' },
  { n: 4, label: 'Thu' }, { n: 5, label: 'Fri' }, { n: 6, label: 'Sat' }, { n: 7, label: 'Sun' },
]

interface Shift {
  id: string; name: string; start_time: string; end_time: string
  crosses_midnight: boolean; grace_minutes: number
  half_day_min_minutes: number; full_day_min_minutes: number
  weekly_off_days: number[]; is_active: boolean
}
interface StaffMember {
  id: string; full_name: string; employee_code: string | null; profile_id: string | null
  join_date: string | null; default_shift_id: string | null; weekly_off_days: number[] | null
  phone: string | null; is_active: boolean
  profiles?: { id: string; full_name: string | null; username: string | null; employee_id: string | null } | null
}
interface Network { id: string; label: string; cidr: string; is_active: boolean; notes: string | null }
interface Holiday { id: string; name: string; festival_date: string; is_major: boolean; is_business_holiday: boolean }
interface AppUser { id: string; full_name: string | null; username: string | null; employee_id?: string | null }

function WeeklyOffPicker({ value, onChange, allowInherit }: {
  value: number[] | null; onChange: (v: number[] | null) => void; allowInherit?: boolean
}) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {DOW.map(d => (
        <label key={d.n} className="flex items-center gap-1 text-xs">
          <Checkbox
            checked={!!value?.includes(d.n)}
            onCheckedChange={(c) => {
              const base = value ?? []
              onChange(c ? [...base, d.n].sort() : base.filter(x => x !== d.n))
            }}
          />
          {d.label}
        </label>
      ))}
      {allowInherit && (
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => onChange(null)}>
          Use shift default
        </Button>
      )}
    </div>
  )
}

// Settings > Attendance & Staff. Owner-only (gated by CATEGORIES in
// app/dashboard/settings/page.tsx), four sections in one manager rather than
// four tabs, since they are configured together when the module is first set up.
export default function AttendanceSettingsManager() {
  const [section, setSection] = useState<Section>('shifts')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const [shifts, setShifts] = useState<Shift[]>([])
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [users, setUsers] = useState<AppUser[]>([])
  const [networks, setNetworks] = useState<Network[]>([])
  const [enforced, setEnforced] = useState(false)
  const [failingOpen, setFailingOpen] = useState(false)
  const [myIp, setMyIp] = useState<string | null>(null)
  const [ipVerifiable, setIpVerifiable] = useState(true)
  const [holidays, setHolidays] = useState<Holiday[]>([])

  // new-row drafts
  const [newShift, setNewShift] = useState({ name: '', start_time: '09:30', end_time: '18:30', grace_minutes: 10, half_day_min_minutes: 240, full_day_min_minutes: 450, weekly_off_days: [7] as number[] })
  const [newStaff, setNewStaff] = useState({ full_name: '', employee_code: '', profile_id: '', join_date: '', default_shift_id: '', phone: '' })
  const [newNetwork, setNewNetwork] = useState({ label: '', cidr: '' })
  const [newHoliday, setNewHoliday] = useState({ name: '', festival_date: istToday() })

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const [sh, st, us, nw, hol, ip] = await Promise.all([
      apiFetch('/api/settings/attendance-shifts'),
      apiFetch('/api/staff'),
      apiFetch('/api/users'),
      apiFetch('/api/settings/attendance-networks'),
      apiFetch('/api/settings/attendance-holidays?closures_only=true'),
      apiFetch('/api/attendance/my-ip'),
    ])
    if (sh.ok) setShifts(await sh.json())
    if (st.ok) setStaff(await st.json())
    if (us.ok) {
      const json = await us.json()
      setUsers(Array.isArray(json) ? json : json.data || [])
    }
    if (nw.ok) {
      const json = await nw.json()
      setNetworks(json.networks || [])
      setEnforced(!!json.enforced)
      setFailingOpen(!!json.failing_open)
    }
    if (hol.ok) setHolidays(await hol.json())
    if (ip.ok) {
      const j = await ip.json()
      setMyIp(j.ip)
      setIpVerifiable(!!j.verifiable)
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function mutate(url: string, method: string, body?: unknown) {
    setError('')
    const res = await apiFetch(url, { method, body: body ? JSON.stringify(body) : undefined })
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || 'That change could not be saved.')
      return false
    }
    await load()
    return true
  }

  const addShift = useAsyncAction(async () => {
    if (!newShift.name.trim()) { setError('Give the shift a name.'); return }
    if (await mutate('/api/settings/attendance-shifts', 'POST', newShift)) {
      setNewShift({ ...newShift, name: '' })
    }
  })
  const addStaff = useAsyncAction(async () => {
    if (!newStaff.full_name.trim()) { setError('Give the staff member a name.'); return }
    const body: Record<string, unknown> = { full_name: newStaff.full_name.trim() }
    for (const k of ['employee_code', 'profile_id', 'join_date', 'default_shift_id', 'phone'] as const) {
      if (newStaff[k]) body[k] = newStaff[k]
    }
    if (await mutate('/api/staff', 'POST', body)) {
      setNewStaff({ full_name: '', employee_code: '', profile_id: '', join_date: '', default_shift_id: '', phone: '' })
    }
  })
  const addNetwork = useAsyncAction(async () => {
    if (!newNetwork.label.trim() || !newNetwork.cidr.trim()) { setError('Both a label and an IP/range are needed.'); return }
    if (await mutate('/api/settings/attendance-networks', 'POST', newNetwork)) {
      setNewNetwork({ label: '', cidr: '' })
    }
  })
  const addHoliday = useAsyncAction(async () => {
    if (!newHoliday.name.trim()) { setError('Name the closure.'); return }
    if (await mutate('/api/settings/attendance-holidays', 'POST', { ...newHoliday, is_major: false, is_business_holiday: true })) {
      setNewHoliday({ name: '', festival_date: istToday() })
    }
  })
  const toggleEnforce = useAsyncAction(async (next: boolean) => {
    await mutate('/api/settings/attendance-networks', 'POST', { enforced: next })
  })

  if (loading) {
    return <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Attendance &amp; Staff</h2>
        <p className="text-sm text-muted-foreground">
          The staff roster is separate from logins — most staff do not need an account to be
          tracked here. Adding someone here does not change the &quot;Sold By&quot; name list.
        </p>
      </div>

      <div className="flex items-center gap-1 border-b border-border overflow-x-auto">
        {SECTIONS.map(s => (
          <button key={s.key} onClick={() => setSection(s.key)}
            className={`px-3 py-2 text-sm -mb-px border-b-2 whitespace-nowrap transition-colors ${
              section === s.key ? 'border-primary text-foreground font-medium' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}>
            {s.label}
          </button>
        ))}
      </div>

      {error && <ErrorBanner message={error} />}

      {/* ---------------- Shifts ---------------- */}
      {section === 'shifts' && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            A day counts as present at or above the full-day minutes, half-day between the two,
            and absent below. Grace only decides the &quot;late&quot; flag — lateness in minutes is
            recorded either way.
          </p>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr className="text-left">
                  <th className="p-2 font-medium">Name</th>
                  <th className="p-2 font-medium">Start</th>
                  <th className="p-2 font-medium">End</th>
                  <th className="p-2 font-medium text-right">Grace</th>
                  <th className="p-2 font-medium text-right">Half day</th>
                  <th className="p-2 font-medium text-right">Full day</th>
                  <th className="p-2 font-medium">Weekly off</th>
                  <th className="p-2 font-medium w-10" />
                </tr>
              </thead>
              <tbody>
                {shifts.map(s => (
                  <tr key={s.id} className={`border-t border-border ${!s.is_active ? 'opacity-50' : ''}`}>
                    <td className="p-2">{s.name}</td>
                    <td className="p-2 tabular-nums">{s.start_time.slice(0, 5)}</td>
                    <td className="p-2 tabular-nums">{s.end_time.slice(0, 5)}</td>
                    <td className="p-2 text-right tabular-nums">{s.grace_minutes}m</td>
                    <td className="p-2 text-right tabular-nums">{s.half_day_min_minutes}m</td>
                    <td className="p-2 text-right tabular-nums">{s.full_day_min_minutes}m</td>
                    <td className="p-2 text-xs">
                      {(s.weekly_off_days || []).map(n => DOW.find(d => d.n === n)?.label).join(', ') || '--'}
                    </td>
                    <td className="p-2">
                      {s.is_active && (
                        <Button variant="ghost" size="sm" className="h-8 px-2 text-destructive"
                          onClick={() => mutate(`/api/settings/attendance-shifts/${s.id}`, 'DELETE')}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
                {shifts.length === 0 && (
                  <tr><td colSpan={8} className="p-3 text-center text-sm text-muted-foreground">No shifts yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="rounded-md border border-border p-3 space-y-2">
            <div className="text-sm font-medium">Add a shift</div>
            <div className="grid gap-2 sm:grid-cols-3">
              <Input className="h-8" placeholder="Name (e.g. General)" value={newShift.name}
                onChange={e => setNewShift({ ...newShift, name: e.target.value })} />
              <Input className="h-8" type="time" value={newShift.start_time}
                onChange={e => setNewShift({ ...newShift, start_time: e.target.value })} />
              <Input className="h-8" type="time" value={newShift.end_time}
                onChange={e => setNewShift({ ...newShift, end_time: e.target.value })} />
              <Input className="h-8" type="number" placeholder="Grace (min)" value={newShift.grace_minutes}
                onChange={e => setNewShift({ ...newShift, grace_minutes: Number(e.target.value) })} />
              <Input className="h-8" type="number" placeholder="Half-day min" value={newShift.half_day_min_minutes}
                onChange={e => setNewShift({ ...newShift, half_day_min_minutes: Number(e.target.value) })} />
              <Input className="h-8" type="number" placeholder="Full-day min" value={newShift.full_day_min_minutes}
                onChange={e => setNewShift({ ...newShift, full_day_min_minutes: Number(e.target.value) })} />
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">Weekly off</div>
              <WeeklyOffPicker value={newShift.weekly_off_days}
                onChange={v => setNewShift({ ...newShift, weekly_off_days: v ?? [] })} />
            </div>
            <Button size="sm" className="h-8" disabled={addShift.pending} onClick={() => addShift.run()}>
              {addShift.pending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Plus className="h-3.5 w-3.5 mr-1" />}
              Add shift
            </Button>
          </div>
        </div>
      )}

      {/* ---------------- Roster ---------------- */}
      {section === 'roster' && (
        <div className="space-y-3">
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr className="text-left">
                  <th className="p-2 font-medium">Name</th>
                  <th className="p-2 font-medium">Code</th>
                  <th className="p-2 font-medium">Login</th>
                  <th className="p-2 font-medium">Shift</th>
                  <th className="p-2 font-medium">Weekly off</th>
                  <th className="p-2 font-medium">Active</th>
                  <th className="p-2 font-medium w-10" />
                </tr>
              </thead>
              <tbody>
                {staff.map(s => (
                  <tr key={s.id} className={`border-t border-border ${!s.is_active ? 'opacity-50' : ''}`}>
                    <td className="p-2">{s.full_name}</td>
                    <td className="p-2">{s.employee_code || '--'}</td>
                    <td className="p-2">
                      <select
                        className="h-8 rounded-md border border-input bg-background px-2 text-sm max-w-[12rem]"
                        value={s.profile_id || ''}
                        onChange={e => mutate(`/api/staff/${s.id}`, 'PATCH', { profile_id: e.target.value || null })}
                      >
                        <option value="">No login</option>
                        {users.map(u => (
                          <option key={u.id} value={u.id}>{u.full_name || u.username || u.id.slice(0, 8)}</option>
                        ))}
                      </select>
                    </td>
                    <td className="p-2">
                      <select
                        className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                        value={s.default_shift_id || ''}
                        onChange={e => mutate(`/api/staff/${s.id}`, 'PATCH', { default_shift_id: e.target.value || null })}
                      >
                        <option value="">None</option>
                        {shifts.filter(sh => sh.is_active).map(sh => (
                          <option key={sh.id} value={sh.id}>{sh.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="p-2">
                      <WeeklyOffPicker
                        value={s.weekly_off_days}
                        allowInherit
                        onChange={v => mutate(`/api/staff/${s.id}`, 'PATCH', { weekly_off_days: v })}
                      />
                    </td>
                    <td className="p-2">
                      <Checkbox checked={s.is_active}
                        onCheckedChange={c => mutate(`/api/staff/${s.id}`, 'PATCH', { is_active: !!c })} />
                    </td>
                    <td className="p-2">
                      <Button variant="ghost" size="sm" className="h-8 px-2 text-destructive"
                        onClick={() => mutate(`/api/staff/${s.id}`, 'DELETE')}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
                {staff.length === 0 && (
                  <tr><td colSpan={7} className="p-3 text-center text-sm text-muted-foreground">No staff on the roster yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">
            Leave &quot;Login&quot; as <em>No login</em> for staff without an account — they can still be marked
            by you on the register, but cannot punch themselves. Removing someone keeps their
            attendance history.
          </p>

          <div className="rounded-md border border-border p-3 space-y-2">
            <div className="text-sm font-medium">Add a staff member</div>
            <div className="grid gap-2 sm:grid-cols-3">
              <Input className="h-8" placeholder="Full name" value={newStaff.full_name}
                onChange={e => setNewStaff({ ...newStaff, full_name: e.target.value })} />
              <Input className="h-8" placeholder="Employee code" value={newStaff.employee_code}
                onChange={e => setNewStaff({ ...newStaff, employee_code: e.target.value })} />
              <Input className="h-8" placeholder="Phone" value={newStaff.phone}
                onChange={e => setNewStaff({ ...newStaff, phone: e.target.value })} />
              <select className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                value={newStaff.profile_id} onChange={e => setNewStaff({ ...newStaff, profile_id: e.target.value })}>
                <option value="">No login</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.full_name || u.username || u.id.slice(0, 8)}</option>)}
              </select>
              <select className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                value={newStaff.default_shift_id} onChange={e => setNewStaff({ ...newStaff, default_shift_id: e.target.value })}>
                <option value="">No shift</option>
                {shifts.filter(s => s.is_active).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <Input className="h-8" type="date" value={newStaff.join_date}
                onChange={e => setNewStaff({ ...newStaff, join_date: e.target.value })} />
            </div>
            <Button size="sm" className="h-8" disabled={addStaff.pending} onClick={() => addStaff.run()}>
              {addStaff.pending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Plus className="h-3.5 w-3.5 mr-1" />}
              Add to roster
            </Button>
          </div>
        </div>
      )}

      {/* ---------------- Office networks ---------------- */}
      {section === 'networks' && (
        <div className="space-y-3">
          <div className="rounded-md border border-border p-3 space-y-2">
            <label className="flex items-start gap-2 text-sm">
              <Checkbox checked={enforced} onCheckedChange={c => toggleEnforce.run(!!c)} />
              <span>
                <span className="font-medium">Only allow punching from the office network</span>
                <span className="block text-xs text-muted-foreground">
                  Applies to staff punching their own card. You and managers can still mark or
                  correct attendance from anywhere.
                </span>
              </span>
            </label>
            {failingOpen && (
              <div className="flex items-start gap-2 rounded-md bg-warning/10 border border-warning/20 p-2 text-xs text-warning">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>
                  This is switched on but no network is listed below, so punching is currently
                  allowed from anywhere. Add your shop&apos;s IP to make it take effect — the
                  check deliberately stays open rather than locking everyone out.
                </span>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              This stops casual punching from home or mobile data. It is not tamper-proof, so
              treat it as a deterrent rather than a guarantee.
            </p>
          </div>

          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr className="text-left">
                  <th className="p-2 font-medium">Label</th>
                  <th className="p-2 font-medium">IP / range</th>
                  <th className="p-2 font-medium">Active</th>
                  <th className="p-2 font-medium w-10" />
                </tr>
              </thead>
              <tbody>
                {networks.map(n => (
                  <tr key={n.id} className="border-t border-border">
                    <td className="p-2">{n.label}</td>
                    <td className="p-2 tabular-nums">{n.cidr}</td>
                    <td className="p-2">
                      <Checkbox checked={n.is_active}
                        onCheckedChange={c => mutate(`/api/settings/attendance-networks/${n.id}`, 'PATCH', { is_active: !!c })} />
                    </td>
                    <td className="p-2">
                      <Button variant="ghost" size="sm" className="h-8 px-2 text-destructive"
                        onClick={() => mutate(`/api/settings/attendance-networks/${n.id}`, 'DELETE')}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
                {networks.length === 0 && (
                  <tr><td colSpan={4} className="p-3 text-center text-sm text-muted-foreground">No networks listed.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="rounded-md border border-border p-3 space-y-2">
            <div className="text-sm font-medium">Add a network</div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Input className="h-8" placeholder="Label (e.g. Shop wifi)" value={newNetwork.label}
                onChange={e => setNewNetwork({ ...newNetwork, label: e.target.value })} />
              <Input className="h-8" placeholder="e.g. 49.36.12.7 or 49.36.12.0/24" value={newNetwork.cidr}
                onChange={e => setNewNetwork({ ...newNetwork, cidr: e.target.value })} />
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button size="sm" className="h-8" disabled={addNetwork.pending} onClick={() => addNetwork.run()}>
                {addNetwork.pending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Plus className="h-3.5 w-3.5 mr-1" />}
                Add network
              </Button>
              {myIp && (
                <Button variant="outline" size="sm" className="h-8"
                  onClick={() => setNewNetwork({ label: newNetwork.label || 'This location', cidr: myIp })}>
                  Use this device&apos;s IP ({myIp})
                </Button>
              )}
            </div>
            {!ipVerifiable && (
              <div className="flex items-start gap-2 rounded-md bg-warning/10 border border-warning/20 p-2 text-xs text-warning">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>
                  This server cannot verify visitors&apos; IP addresses, so switching the setting
                  above on would block everyone from punching rather than just off-site staff.
                  This is normal when running locally; on the live site it works.
                </span>
              </div>
            )}
            <div>
            </div>
            <p className="text-xs text-muted-foreground">
              A home broadband IP usually changes from time to time. If punching suddenly stops
              working, open this page from the shop and use the button above to update it.
            </p>
          </div>
        </div>
      )}

      {/* ---------------- Holidays ---------------- */}
      {section === 'holidays' && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Days the shop is shut. Staff are marked &quot;holiday&quot; instead of absent, and leave
            is not consumed. These live on the same festival calendar Marketing uses, so most
            festivals listed there are <em>not</em> closures unless ticked here.
          </p>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr className="text-left">
                  <th className="p-2 font-medium">Date</th>
                  <th className="p-2 font-medium">Name</th>
                  <th className="p-2 font-medium">Shop closed</th>
                </tr>
              </thead>
              <tbody>
                {holidays.map(h => (
                  <tr key={h.id} className="border-t border-border">
                    <td className="p-2 tabular-nums">{h.festival_date}</td>
                    <td className="p-2">{h.name}</td>
                    <td className="p-2">
                      <Checkbox checked={h.is_business_holiday}
                        onCheckedChange={c => mutate('/api/settings/attendance-holidays', 'PATCH', { id: h.id, is_business_holiday: !!c })} />
                    </td>
                  </tr>
                ))}
                {holidays.length === 0 && (
                  <tr><td colSpan={3} className="p-3 text-center text-sm text-muted-foreground">No closures recorded.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="rounded-md border border-border p-3 space-y-2">
            <div className="text-sm font-medium">Add a closure</div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Input className="h-8" placeholder="Reason (e.g. Stock-take)" value={newHoliday.name}
                onChange={e => setNewHoliday({ ...newHoliday, name: e.target.value })} />
              <Input className="h-8" type="date" value={newHoliday.festival_date}
                onChange={e => setNewHoliday({ ...newHoliday, festival_date: e.target.value })} />
            </div>
            <Button size="sm" className="h-8" disabled={addHoliday.pending} onClick={() => addHoliday.run()}>
              {addHoliday.pending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Plus className="h-3.5 w-3.5 mr-1" />}
              Add closure
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
