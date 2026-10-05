'use client'

import { useState, useEffect, useCallback, useMemo, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { apiFetch } from '@/lib/api-client'
import { useRole } from '@/lib/auth/useRole'
import { useCustomOptions } from '@/lib/useCustomOptions'
import RequirePageAccess from '@/components/RequirePageAccess'
import BulkImportDialog from '@/components/BulkImportDialog'
import { SimpleModal } from '@/components/SimpleModal'
import { StatusBadge } from '@/components/StatusBadge'
import { Pagination } from '@/components/Pagination'
import { LEAD_SET_STATUS_TONES } from '@/lib/status-styles'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { createClient } from '@/lib/supabase/client'
import { Loader2, Plus, Users, History, Copy, ArrowLeft, Phone, Mail, MapPin } from 'lucide-react'
import { toast } from 'sonner'
import { useAsyncAction } from '@/lib/useAsyncAction'

interface LeadSet {
  id: string
  name: string
  description: string | null
  source_type: string
  status: string
  current_assignee_id: string | null
  assignee_name: string | null
  cloned_from_set_id: string | null
  created_at: string
  counts: { total: number; worked: number; converted: number }
}

interface Lead {
  id: string
  set_id: string
  name: string
  phone: string | null
  email: string | null
  address: string | null
  external_identifier: string | null
  status: string
  converted_customer_id: string | null
  activity_id: string | null
  created_at: string
  follow_up_date: string | null
  last_note: string | null
  last_note_at: string | null
}

const FOLLOWUP_FILTER_OPTIONS = [
  { value: 'all', label: 'All leads' },
  { value: 'overdue', label: 'Overdue follow-up' },
  { value: 'due_today', label: 'Due today' },
  { value: 'upcoming', label: 'Upcoming follow-up' },
  { value: 'any', label: 'Has a follow-up set' },
  { value: 'none', label: 'No follow-up set' },
]

function followUpTone(dateStr: string | null): 'danger' | 'warning' | 'info' | 'neutral' {
  if (!dateStr) return 'neutral'
  const today = new Date().toISOString().slice(0, 10)
  if (dateStr < today) return 'danger'
  if (dateStr === today) return 'warning'
  return 'info'
}

interface AssignableUser { id: string; full_name: string | null; role: string }

function SetsTable({
  sets, loading, onOpen, onReassign, onClone, onRename, onDelete, isManagerOrAbove,
}: {
  sets: LeadSet[]; loading: boolean; onOpen: (s: LeadSet) => void
  onReassign: (s: LeadSet) => void; onClone: (s: LeadSet) => void
  onRename: (s: LeadSet) => void; onDelete: (s: LeadSet) => void
  isManagerOrAbove: boolean
}) {
  if (loading) return <div className="p-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
  if (sets.length === 0) return <div className="p-8 text-center text-sm text-muted-foreground">No Lead Sets yet.</div>

  return (
    <>
      <div className="hidden md:block rounded-md border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="p-2">Created</th>
              <th className="p-2">Set</th>
              <th className="p-2">Assigned to</th>
              <th className="p-2">Status</th>
              <th className="p-2 text-right">Worked / Total</th>
              <th className="p-2 text-right">Converted</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {sets.map((s) => (
              <tr key={s.id} className="border-t hover:bg-muted/30">
                <td className="p-2 tabular-nums whitespace-nowrap">{new Date(s.created_at).toLocaleDateString()}</td>
                <td className="p-2">
                  <button className="font-medium text-left hover:underline" onClick={() => onOpen(s)}>{s.name}</button>
                  {s.cloned_from_set_id && <Badge variant="outline" className="ml-2 text-xs">fresh copy</Badge>}
                  {s.description && <div className="text-xs text-muted-foreground">{s.description}</div>}
                </td>
                <td className="p-2">{s.assignee_name || <span className="text-muted-foreground">Unassigned</span>}</td>
                <td className="p-2"><StatusBadge tone={LEAD_SET_STATUS_TONES[s.status] || 'neutral'}>{s.status}</StatusBadge></td>
                <td className="p-2 text-right tabular-nums">{s.counts.worked} / {s.counts.total}</td>
                <td className="p-2 text-right tabular-nums">{s.counts.converted}</td>
                <td className="p-2 text-right whitespace-nowrap">
                  <Button variant="link" size="sm" onClick={() => onOpen(s)}>Open</Button>
                  <Button variant="link" size="sm" onClick={() => onRename(s)}>Rename</Button>
                  {isManagerOrAbove && <Button variant="link" size="sm" onClick={() => onReassign(s)}>Reassign</Button>}
                  {isManagerOrAbove && <Button variant="link" size="sm" onClick={() => onClone(s)}>Clone fresh</Button>}
                  <Button variant="link" size="sm" className="text-destructive" onClick={() => onDelete(s)}>Delete</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="md:hidden space-y-2">
        {sets.map((s) => (
          <div key={s.id} className="rounded-md border p-3 space-y-1">
            <div className="flex justify-between items-start">
              <div>
                <div className="text-xs text-muted-foreground tabular-nums">{new Date(s.created_at).toLocaleDateString()}</div>
                <button className="font-medium text-left hover:underline" onClick={() => onOpen(s)}>{s.name}</button>
              </div>
              <StatusBadge tone={LEAD_SET_STATUS_TONES[s.status] || 'neutral'}>{s.status}</StatusBadge>
            </div>
            <div className="text-sm text-muted-foreground">Assigned to: {s.assignee_name || 'Unassigned'}</div>
            <div className="text-sm tabular-nums">{s.counts.worked} / {s.counts.total} worked · {s.counts.converted} converted</div>
            <div className="flex gap-2 pt-1 flex-wrap">
              <Button size="sm" variant="outline" onClick={() => onOpen(s)}>Open</Button>
              <Button size="sm" variant="outline" onClick={() => onRename(s)}>Rename</Button>
              {isManagerOrAbove && <Button size="sm" variant="outline" onClick={() => onReassign(s)}>Reassign</Button>}
              {isManagerOrAbove && <Button size="sm" variant="outline" onClick={() => onClone(s)}>Clone fresh</Button>}
              <Button size="sm" variant="outline" className="text-destructive" onClick={() => onDelete(s)}>Delete</Button>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

function LeadRow({
  lead, statusOptions, onUpdate, onOpenDetail, variant,
}: {
  lead: Lead; statusOptions: string[]; onUpdate: (patch: Partial<Lead>) => void
  onOpenDetail: () => void; variant: 'table' | 'card'
}) {
  const { run: setStatus, pending } = useAsyncAction(async (newStatus: string) => {
    const res = await apiFetch(`/api/leads/${lead.id}`, { method: 'PATCH', body: JSON.stringify({ status: newStatus }) })
    if (res.ok) onUpdate({ status: newStatus })
    else toast.error('Failed to update status.')
  })

  const statusControl = (
    <Select value={lead.status} onValueChange={(v) => setStatus(v)} disabled={pending}>
      <SelectTrigger className="h-8 w-[160px]"><SelectValue /></SelectTrigger>
      <SelectContent>
        {statusOptions.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
      </SelectContent>
    </Select>
  )

  const followUpBadge = lead.follow_up_date && (
    <StatusBadge tone={followUpTone(lead.follow_up_date)}>
      Follow up {new Date(lead.follow_up_date).toLocaleDateString()}
    </StatusBadge>
  )

  if (variant === 'card') {
    return (
      <div className="rounded-md border p-3 space-y-1">
        <div className="flex justify-between items-start">
          <div className="text-xs text-muted-foreground tabular-nums">{new Date(lead.created_at).toLocaleDateString()}</div>
          {lead.converted_customer_id && <Badge className="text-xs">Converted</Badge>}
        </div>
        <button className="font-medium text-left hover:underline block" onClick={onOpenDetail}>{lead.name}</button>
        {lead.phone && <a href={`tel:${lead.phone}`} className="flex items-center gap-1 text-sm text-info"><Phone className="h-3 w-3" />{lead.phone}</a>}
        {lead.email && <div className="flex items-center gap-1 text-sm text-muted-foreground"><Mail className="h-3 w-3" />{lead.email}</div>}
        {lead.address && <div className="flex items-center gap-1 text-sm text-muted-foreground"><MapPin className="h-3 w-3" />{lead.address}</div>}
        {followUpBadge && <div>{followUpBadge}</div>}
        {lead.last_note && <p className="text-xs text-muted-foreground truncate">Last remark: {lead.last_note}</p>}
        <div className="pt-1">{statusControl}</div>
      </div>
    )
  }

  return (
    <tr className="border-t hover:bg-muted/30">
      <td className="p-2 tabular-nums whitespace-nowrap">{new Date(lead.created_at).toLocaleDateString()}</td>
      <td className="p-2"><button className="font-medium text-left hover:underline" onClick={onOpenDetail}>{lead.name}</button></td>
      <td className="p-2">{lead.phone ? <a href={`tel:${lead.phone}`} className="text-info">{lead.phone}</a> : '-'}</td>
      <td className="p-2">{lead.email || '-'}</td>
      <td className="p-2 max-w-[160px] truncate">{lead.address || '-'}</td>
      <td className="p-2">{lead.external_identifier || '-'}</td>
      <td className="p-2 max-w-[220px] truncate text-muted-foreground" title={lead.last_note || ''}>{lead.last_note || '-'}</td>
      <td className="p-2">{followUpBadge || '-'}</td>
      <td className="p-2">{statusControl}</td>
      <td className="p-2">{lead.converted_customer_id && <Badge>Converted</Badge>}</td>
    </tr>
  )
}

function LeadDetailModal({ lead, onClose, onUpdated }: { lead: Lead; onClose: () => void; onUpdated: (patch: Partial<Lead>) => void }) {
  const [comments, setComments] = useState<{ id: string; author_name: string; body: string; created_at: string }[]>([])
  const [loadingThread, setLoadingThread] = useState(true)
  const [noteText, setNoteText] = useState('')
  const [followUpDate, setFollowUpDate] = useState(lead.follow_up_date || '')

  const loadThread = useCallback(async () => {
    setLoadingThread(true)
    const res = await apiFetch(`/api/leads/${lead.id}/notes`)
    if (res.ok) {
      const json = await res.json()
      setComments(json.comments || [])
      setFollowUpDate(json.follow_up_date || '')
    }
    setLoadingThread(false)
  }, [lead.id])

  useEffect(() => { loadThread() }, [loadThread])

  // A note and/or a follow-up date in one request -- either is a valid reason
  // to log this lead's first touch (see the API route's comment on why this is
  // the whole "agent sees it and calls back" mechanism, via activities.due_date).
  const { run: addNote, pending: addingNote } = useAsyncAction(async () => {
    if (!noteText.trim()) return
    const res = await apiFetch(`/api/leads/${lead.id}/notes`, { method: 'POST', body: JSON.stringify({ body: noteText.trim() }) })
    if (res.ok) { setNoteText(''); await loadThread() } else toast.error('Failed to add note.')
  })

  const { run: saveFollowUp, pending: savingFollowUp } = useAsyncAction(async (newDate: string) => {
    const res = await apiFetch(`/api/leads/${lead.id}/notes`, { method: 'POST', body: JSON.stringify({ follow_up_date: newDate || null }) })
    if (res.ok) {
      setFollowUpDate(newDate)
      onUpdated({ follow_up_date: newDate || null })
      toast.success(newDate ? 'Follow-up date set.' : 'Follow-up date cleared.')
    } else {
      toast.error('Failed to update follow-up date.')
    }
  })

  const { run: convert, pending: converting } = useAsyncAction(async () => {
    const res = await apiFetch(`/api/leads/${lead.id}/convert-to-customer`, { method: 'POST', body: JSON.stringify({}) })
    const json = await res.json().catch(() => ({}))
    if (res.ok) {
      toast.success(json.linked_existing ? 'Linked to an existing customer.' : 'Converted to a new customer.')
      onUpdated({ converted_customer_id: json.customer_id })
    } else if (res.status === 409 && json.name_warning) {
      if (confirm(`A customer named "${json.name_warning.customer_name}" already exists under a different phone. Convert anyway?`)) {
        const res2 = await apiFetch(`/api/leads/${lead.id}/convert-to-customer`, { method: 'POST', body: JSON.stringify({ confirm_despite_name_warning: true }) })
        const json2 = await res2.json().catch(() => ({}))
        if (res2.ok) { toast.success('Converted to a new customer.'); onUpdated({ converted_customer_id: json2.customer_id }) }
        else toast.error(json2.error || 'Failed to convert.')
      }
    } else {
      toast.error(json.error || 'Failed to convert.')
    }
  })

  return (
    <SimpleModal isOpen onClose={onClose} title={lead.name} wide>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div><span className="text-muted-foreground">Phone:</span> {lead.phone || '-'}</div>
          <div><span className="text-muted-foreground">Email:</span> {lead.email || '-'}</div>
          <div className="col-span-2"><span className="text-muted-foreground">Address:</span> {lead.address || '-'}</div>
          <div className="col-span-2"><span className="text-muted-foreground">Identifier:</span> {lead.external_identifier || '-'}</div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {!lead.converted_customer_id && (
            <Button size="sm" variant="outline" onClick={() => convert()} loading={converting}>Convert to Customer</Button>
          )}
          {lead.converted_customer_id && <Badge>Converted to customer</Badge>}
        </div>

        <div className="flex items-center gap-2">
          <Label className="text-sm whitespace-nowrap">Follow-up date</Label>
          <Input
            type="date"
            value={followUpDate}
            onChange={(e) => saveFollowUp(e.target.value)}
            disabled={savingFollowUp}
            className="w-44"
          />
          {followUpDate && (
            <Button size="sm" variant="ghost" onClick={() => saveFollowUp('')} disabled={savingFollowUp}>Clear</Button>
          )}
        </div>

        <div>
          <h3 className="text-sm font-medium mb-2 flex items-center gap-1"><History className="h-4 w-4" /> Call history</h3>
          {loadingThread ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : comments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No calls logged yet -- the first note starts the history.</p>
          ) : (
            <div className="space-y-2 max-h-60 overflow-y-auto border rounded-md p-2">
              {comments.map((c) => (
                <div key={c.id} className="text-sm">
                  <span className="font-medium">{c.author_name}</span>{' '}
                  <span className="text-xs text-muted-foreground">{new Date(c.created_at).toLocaleString()}</span>
                  <div>{c.body}</div>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2 mt-2">
            <Input value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Log a call or note..." />
            <Button onClick={() => addNote()} disabled={!noteText.trim()} loading={addingNote}>Add</Button>
          </div>
        </div>
      </div>
    </SimpleModal>
  )
}

function RenameModal({ set, onClose, onDone }: { set: LeadSet; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(set.name)
  const [description, setDescription] = useState(set.description || '')

  const { run: submit, pending } = useAsyncAction(async () => {
    if (!name.trim()) return
    const res = await apiFetch(`/api/lead-sets/${set.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: name.trim(), description: description.trim() || null }),
    })
    if (res.ok) { toast.success('Set updated.'); onDone() }
    else { const j = await res.json().catch(() => ({})); toast.error(j.error || 'Failed to update set.') }
  })

  return (
    <SimpleModal isOpen onClose={onClose} title="Rename Set">
      <div className="space-y-3">
        <div>
          <Label className="text-xs">Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1" />
        </div>
        <div>
          <Label className="text-xs">Description</Label>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} className="mt-1" />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => submit()} disabled={!name.trim()} loading={pending}>Save</Button>
        </div>
      </div>
    </SimpleModal>
  )
}

function ReassignModal({ set, onClose, onDone }: { set: LeadSet; onClose: () => void; onDone: () => void }) {
  const [users, setUsers] = useState<AssignableUser[]>([])
  const [assigneeId, setAssigneeId] = useState('')
  useEffect(() => { apiFetch('/api/lead-sets/assignable-users').then((r) => r.json()).then((d) => setUsers(d || [])) }, [])

  const { run: submit, pending } = useAsyncAction(async () => {
    if (!assigneeId) return
    const res = await apiFetch(`/api/lead-sets/${set.id}/reassign`, { method: 'POST', body: JSON.stringify({ new_assignee_id: assigneeId }) })
    if (res.ok) { toast.success('Set reassigned -- the new holder sees full history.'); onDone() }
    else { const j = await res.json().catch(() => ({})); toast.error(j.error || 'Failed to reassign.') }
  })

  return (
    <SimpleModal isOpen onClose={onClose} title={`Reassign "${set.name}"`}>
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">The new holder will see everything already logged for this set.</p>
        <Select value={assigneeId} onValueChange={setAssigneeId}>
          <SelectTrigger><SelectValue placeholder="Choose staff member" /></SelectTrigger>
          <SelectContent>
            {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.full_name || u.role}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => submit()} disabled={!assigneeId} loading={pending}>Reassign</Button>
        </div>
      </div>
    </SimpleModal>
  )
}

function CloneModal({ set, onClose, onDone }: { set: LeadSet; onClose: () => void; onDone: () => void }) {
  const [users, setUsers] = useState<AssignableUser[]>([])
  const [assigneeId, setAssigneeId] = useState('')
  const [name, setName] = useState(`${set.name} (fresh copy)`)
  useEffect(() => { apiFetch('/api/lead-sets/assignable-users').then((r) => r.json()).then((d) => setUsers(d || [])) }, [])

  const { run: submit, pending } = useAsyncAction(async () => {
    if (!assigneeId) return
    const res = await apiFetch(`/api/lead-sets/${set.id}/clone`, { method: 'POST', body: JSON.stringify({ assignee_id: assigneeId, name }) })
    if (res.ok) { toast.success('Fresh copy created with no call history.'); onDone() }
    else { const j = await res.json().catch(() => ({})); toast.error(j.error || 'Failed to clone.') }
  })

  return (
    <SimpleModal isOpen onClose={onClose} title={`Clone "${set.name}" as a fresh copy`}>
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Creates a new set with the same contacts but no call history -- for fresh cold-calling. The original set is untouched.
        </p>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New set name" />
        <Select value={assigneeId} onValueChange={setAssigneeId}>
          <SelectTrigger><SelectValue placeholder="Assign fresh copy to" /></SelectTrigger>
          <SelectContent>
            {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.full_name || u.role}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => submit()} disabled={!assigneeId || !name.trim()} loading={pending}>Clone</Button>
        </div>
      </div>
    </SimpleModal>
  )
}

function FromCustomersModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [users, setUsers] = useState<AssignableUser[]>([])
  const [assigneeId, setAssigneeId] = useState('')
  const [name, setName] = useState('')
  const [allCustomers, setAllCustomers] = useState<{ id: string; customer_name: string; phone: string | null }[]>([])
  const [loadingCustomers, setLoadingCustomers] = useState(true)
  const [search, setSearch] = useState('')
  const [pickedIds, setPickedIds] = useState<Set<string>>(new Set())

  useEffect(() => { apiFetch('/api/lead-sets/assignable-users').then((r) => r.json()).then((d) => setUsers(d || [])) }, [])

  // Full active customer list, not a 5-6-result search combobox -- this modal
  // needs "pick several from everyone", which is a different job from the
  // single-pick SearchableCustomerSelect used on sale/invoice entry forms.
  useEffect(() => {
    let cancelled = false
    setLoadingCustomers(true)
    const supabase = createClient()
    supabase
      .from('customers')
      .select('id, customer_name, phone')
      .eq('is_deleted', false)
      .order('customer_name')
      .limit(5000)
      .then(({ data }: { data: { id: string; customer_name: string; phone: string | null }[] | null }) => {
        if (!cancelled) { setAllCustomers(data || []); setLoadingCustomers(false) }
      })
    return () => { cancelled = true }
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return allCustomers
    return allCustomers.filter((c) => c.customer_name.toLowerCase().includes(q) || (c.phone || '').includes(q))
  }, [allCustomers, search])

  const toggle = (id: string) => {
    setPickedIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }
  const selectAllVisible = () => setPickedIds((prev) => new Set([...prev, ...filtered.map((c) => c.id)]))
  const clearAllVisible = () => setPickedIds((prev) => { const next = new Set(prev); filtered.forEach((c) => next.delete(c.id)); return next })

  const { run: submit, pending } = useAsyncAction(async () => {
    if (!assigneeId || !name.trim() || pickedIds.size === 0) return
    const res = await apiFetch('/api/lead-sets/from-customers', {
      method: 'POST',
      body: JSON.stringify({ name: name.trim(), assignee_id: assigneeId, customer_ids: [...pickedIds] }),
    })
    if (res.ok) { toast.success('Lead set created from customers.'); onDone() }
    else { const j = await res.json().catch(() => ({})); toast.error(j.error || 'Failed to create set.') }
  })

  return (
    <SimpleModal isOpen onClose={onClose} title="New Set from Existing Customers" wide>
      <div className="space-y-3">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Set name, e.g. Win-back Q4" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or phone..." />
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{pickedIds.size} selected</span>
          <div className="flex gap-3">
            <button type="button" className="hover:underline" onClick={selectAllVisible}>Select all visible ({filtered.length})</button>
            <button type="button" className="hover:underline" onClick={clearAllVisible}>Clear visible</button>
          </div>
        </div>
        <div className="border rounded-md max-h-72 overflow-y-auto">
          {loadingCustomers ? (
            <div className="p-4 flex justify-center"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
          ) : filtered.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground text-center">No customers match.</div>
          ) : (
            filtered.map((c) => (
              <label key={c.id} className="flex items-center gap-2 px-3 py-2 border-b last:border-b-0 hover:bg-muted/30 cursor-pointer text-sm">
                <Checkbox checked={pickedIds.has(c.id)} onCheckedChange={() => toggle(c.id)} />
                <span className="font-medium">{c.customer_name}</span>
                {c.phone && <span className="text-muted-foreground">{c.phone}</span>}
              </label>
            ))
          )}
        </div>
        <Select value={assigneeId} onValueChange={setAssigneeId}>
          <SelectTrigger><SelectValue placeholder="Assign to" /></SelectTrigger>
          <SelectContent>
            {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.full_name || u.role}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => submit()} disabled={!assigneeId || !name.trim() || pickedIds.size === 0} loading={pending}>Create</Button>
        </div>
      </div>
    </SimpleModal>
  )
}

function LeadsPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { isManagerOrAbove, userId } = useRole()
  const { values: statusOptions } = useCustomOptions('lead_status')

  const [sets, setSets] = useState<LeadSet[]>([])
  const [loadingSets, setLoadingSets] = useState(true)
  const [scope, setScope] = useState<'mine' | 'all'>('mine')
  const [showImport, setShowImport] = useState(false)
  const [showFromCustomers, setShowFromCustomers] = useState(false)
  const [reassignTarget, setReassignTarget] = useState<LeadSet | null>(null)
  const [cloneTarget, setCloneTarget] = useState<LeadSet | null>(null)
  const [renameTarget, setRenameTarget] = useState<LeadSet | null>(null)

  const { run: deleteSet } = useAsyncAction(async (s: LeadSet) => {
    if (!confirm(`Delete "${s.name}" and all ${s.counts.total} of its leads? This can't be undone from the UI.`)) return
    const res = await apiFetch(`/api/lead-sets/${s.id}`, { method: 'DELETE' })
    if (res.ok) { toast.success('Set deleted.'); loadSets() }
    else { const j = await res.json().catch(() => ({})); toast.error(j.error || 'Failed to delete set.') }
  })

  const activeSetId = searchParams.get('set')
  const openLeadId = searchParams.get('open')
  const [leads, setLeads] = useState<Lead[]>([])
  const [loadingLeads, setLoadingLeads] = useState(false)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [statusFilter, setStatusFilter] = useState('all')
  const [followupFilter, setFollowupFilter] = useState('all')
  const [leadSearch, setLeadSearch] = useState('')
  const PAGE_SIZE = 25

  const loadSets = useCallback(async () => {
    setLoadingSets(true)
    const qs = new URLSearchParams()
    if (isManagerOrAbove && scope === 'all') {
      // no assignee filter -- see everything
    } else if (userId) {
      qs.set('assignee_id', userId)
    }
    const res = await apiFetch(`/api/lead-sets?${qs.toString()}`)
    if (res.ok) setSets(await res.json())
    setLoadingSets(false)
  }, [isManagerOrAbove, scope, userId])

  useEffect(() => { loadSets() }, [loadSets])

  const activeSet = useMemo(() => sets.find((s) => s.id === activeSetId) || null, [sets, activeSetId])

  const loadLeads = useCallback(async () => {
    if (!activeSetId) return
    setLoadingLeads(true)
    const qs = new URLSearchParams({ set_id: activeSetId, page: String(page), limit: String(PAGE_SIZE) })
    if (statusFilter !== 'all') qs.set('status', statusFilter)
    if (followupFilter !== 'all') qs.set('followup', followupFilter)
    if (leadSearch.trim()) qs.set('search', leadSearch.trim())
    const res = await apiFetch(`/api/leads?${qs.toString()}`)
    if (res.ok) {
      const json = await res.json()
      setLeads(json.data || [])
      setTotal(json.total || 0)
    } else {
      toast.error('Unable to load this set -- it may no longer be assigned to you.')
    }
    setLoadingLeads(false)
  }, [activeSetId, page, statusFilter, followupFilter, leadSearch])

  // Any filter change should reset back to page 1, not silently show "page 3 of 0".
  useEffect(() => { setPage(1) }, [activeSetId, statusFilter, followupFilter, leadSearch])

  useEffect(() => { loadLeads() }, [loadLeads])

  const [detailLead, setDetailLead] = useState<Lead | null>(null)
  useEffect(() => {
    if (openLeadId && leads.length > 0) setDetailLead(leads.find((l) => l.id === openLeadId) || null)
  }, [openLeadId, leads])

  const openSet = (s: LeadSet) => router.push(`/dashboard/leads?set=${s.id}`)
  const closeSet = () => router.push('/dashboard/leads')

  if (activeSetId) {
    return (
      <div className="space-y-4">
        <Button variant="link" size="sm" onClick={closeSet} className="px-0"><ArrowLeft className="h-4 w-4 mr-1" /> Back to Sets</Button>
        {activeSet && (
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h1 className="text-lg font-semibold">{activeSet.name}</h1>
              <p className="text-sm text-muted-foreground">Assigned to {activeSet.assignee_name || 'unassigned'} · {activeSet.counts.total} contacts</p>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2 items-end">
          <Input value={leadSearch} onChange={(e) => setLeadSearch(e.target.value)} placeholder="Search name, phone, email, identifier..." className="w-64" />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-9 w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {statusOptions.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={followupFilter} onValueChange={setFollowupFilter}>
            <SelectTrigger className="h-9 w-[200px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {FOLLOWUP_FILTER_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {loadingLeads ? (
          <div className="p-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <>
            <div className="hidden md:block rounded-md border overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-muted-foreground">
                  <tr>
                    <th className="p-2">Added</th><th className="p-2">Name</th><th className="p-2">Phone</th>
                    <th className="p-2">Email</th><th className="p-2">Address</th><th className="p-2">Identifier</th>
                    <th className="p-2">Last remark</th><th className="p-2">Follow-up</th>
                    <th className="p-2">Status</th><th className="p-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {leads.map((l) => (
                    <LeadRow key={l.id} lead={l} statusOptions={statusOptions} variant="table"
                      onOpenDetail={() => setDetailLead(l)}
                      onUpdate={(patch) => setLeads((prev) => prev.map((x) => x.id === l.id ? { ...x, ...patch } : x))} />
                  ))}
                </tbody>
              </table>
            </div>
            <div className="md:hidden space-y-2">
              {leads.map((l) => (
                <LeadRow key={l.id} lead={l} statusOptions={statusOptions} variant="card"
                  onOpenDetail={() => setDetailLead(l)}
                  onUpdate={(patch) => setLeads((prev) => prev.map((x) => x.id === l.id ? { ...x, ...patch } : x))} />
              ))}
            </div>
            <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
          </>
        )}

        {detailLead && (
          <LeadDetailModal
            lead={detailLead}
            onClose={() => { setDetailLead(null); router.replace(`/dashboard/leads?set=${activeSetId}`) }}
            onUpdated={(patch) => {
              setLeads((prev) => prev.map((x) => x.id === detailLead.id ? { ...x, ...patch } : x))
              setDetailLead((prev) => prev ? { ...prev, ...patch } : prev)
            }}
          />
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-lg font-semibold flex items-center gap-2"><Users className="h-5 w-5" /> Lead Sets</h1>
          <p className="text-sm text-muted-foreground">Calling lists for sales pitch & follow-up.</p>
        </div>
        <div className="flex gap-2">
          {isManagerOrAbove && <Button variant="outline" onClick={() => setShowFromCustomers(true)}><Copy className="mr-2 h-4 w-4" /> From Customers</Button>}
          <Button onClick={() => setShowImport(true)}><Plus className="mr-2 h-4 w-4" /> New Set</Button>
        </div>
      </div>

      {isManagerOrAbove && (
        <div className="flex gap-2">
          <Button size="sm" variant={scope === 'mine' ? 'default' : 'outline'} onClick={() => setScope('mine')}>My Sets</Button>
          <Button size="sm" variant={scope === 'all' ? 'default' : 'outline'} onClick={() => setScope('all')}>All Sets</Button>
        </div>
      )}

      <SetsTable
        sets={sets} loading={loadingSets} onOpen={openSet}
        onReassign={setReassignTarget} onClone={setCloneTarget}
        onRename={setRenameTarget} onDelete={deleteSet}
        isManagerOrAbove={isManagerOrAbove}
      />

      <BulkImportDialog
        open={showImport} onOpenChange={setShowImport}
        endpoint="/api/lead-sets"
        onImported={loadSets}
      />
      {showFromCustomers && <FromCustomersModal onClose={() => setShowFromCustomers(false)} onDone={() => { setShowFromCustomers(false); loadSets() }} />}
      {reassignTarget && <ReassignModal set={reassignTarget} onClose={() => setReassignTarget(null)} onDone={() => { setReassignTarget(null); loadSets() }} />}
      {cloneTarget && <CloneModal set={cloneTarget} onClose={() => setCloneTarget(null)} onDone={() => { setCloneTarget(null); loadSets() }} />}
      {renameTarget && <RenameModal set={renameTarget} onClose={() => setRenameTarget(null)} onDone={() => { setRenameTarget(null); loadSets() }} />}
    </div>
  )
}

export default function LeadsPage() {
  return (
    <RequirePageAccess pageKey="leads">
      <Suspense fallback={<div className="p-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}>
        <LeadsPageInner />
      </Suspense>
    </RequirePageAccess>
  )
}
