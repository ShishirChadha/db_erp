'use client'

import { useEffect, useState } from 'react'
import { Pause, Play, Pencil, Trash2, Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { SearchableCustomerSelect } from '@/components/SearchableCustomerSelect'
import { apiFetch } from '@/lib/api-client'
import { cn } from '@/lib/utils'

// Settings -> DB Assistant -> DB's learnings. Everything DB has been taught,
// from conversations ("ABC ko hamesha free bag") or added here by hand. Each
// can be edited, paused (kept but not used) or deleted; changes apply from her
// next reply. General learnings are read on every turn; customer ones whenever
// she looks that customer up.

type Learning = {
  id: string; subject_type: 'general' | 'customer'; subject_id: string | null; note: string
  source: 'conversation' | 'manual'; is_active: boolean; created_at: string
  customers: { customer_name: string } | null
}

const EXAMPLES = [
  'Dealers never get a free bag; walk-in customers get bag + mouse free.',
  'Always quote prices including GST unless I say otherwise.',
  'When I say "Ankit" for expenses, it means Ankit Sharma (staff).',
]

export default function AssistantLearnings() {
  const [rows, setRows] = useState<Learning[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [customerId, setCustomerId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)

  const load = () => apiFetch('/api/assistant/notes?all=1').then((r) => r.json()).then((j) => setRows(Array.isArray(j) ? j : [])).catch(() => setRows([]))
  useEffect(() => { load() }, [])

  const call = async (init: RequestInit, url = '/api/assistant/notes') => {
    setErr(null)
    const r = await apiFetch(url, init)
    const j = await r.json().catch(() => ({}))
    if (!r.ok) { setErr(j.error || 'Could not save.'); return null }
    return j
  }
  const add = async () => {
    setAdding(true)
    const saved = await call({ method: 'POST', body: JSON.stringify({ note: draft, customer_id: customerId }) })
    setAdding(false)
    if (saved) { setDraft(''); setCustomerId(null); load() }
  }
  const patch = async (id: string, body: Record<string, unknown>) => {
    const saved = await call({ method: 'PATCH', body: JSON.stringify({ id, ...body }) })
    if (saved) { setEditing(null); setRows((prev) => prev?.map((r) => (r.id === id ? saved : r)) ?? prev) }
  }
  const remove = async (id: string) => {
    if (await call({ method: 'DELETE' }, `/api/assistant/notes?id=${id}`)) setRows((prev) => prev?.filter((r) => r.id !== id) ?? prev)
  }

  const active = (rows || []).filter((r) => r.is_active)
  const paused = (rows || []).filter((r) => !r.is_active)

  const row = (r: Learning) => (
    <div key={r.id} className={cn('rounded-md border p-2 text-sm', !r.is_active && 'opacity-60')}>
      <div className="mb-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <Badge variant="outline">{r.customers?.customer_name || 'General'}</Badge>
        <span>{r.source === 'manual' ? 'added by you' : 'learned in a conversation'} · {new Date(r.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
        {!r.is_active && <Badge variant="secondary">paused</Badge>}
      </div>
      {editing?.id === r.id ? (
        <div className="flex gap-2">
          <textarea value={editing.text} onChange={(e) => setEditing({ id: r.id, text: e.target.value })} rows={2}
            className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1 text-sm" />
          <div className="flex flex-col gap-1">
            <Button size="sm" onClick={() => patch(r.id, { note: editing.text })} aria-label="Save"><Check className="h-4 w-4" /></Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(null)} aria-label="Cancel"><X className="h-4 w-4" /></Button>
          </div>
        </div>
      ) : (
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0">{r.note}</p>
          <div className="flex shrink-0">
            <Button variant="ghost" size="sm" onClick={() => setEditing({ id: r.id, text: r.note })} aria-label="Edit"><Pencil className="h-3.5 w-3.5" /></Button>
            <Button variant="ghost" size="sm" onClick={() => patch(r.id, { is_active: !r.is_active })} aria-label={r.is_active ? 'Pause' : 'Use again'}>
              {r.is_active ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => remove(r.id)} aria-label="Delete"><Trash2 className="h-3.5 w-3.5" /></Button>
          </div>
        </div>
      )}
    </div>
  )

  return (
    <div className="space-y-3">
      <div className="space-y-2 rounded-md bg-muted p-3">
        <p className="text-sm font-medium">Teach DB something</p>
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} placeholder={EXAMPLES[0]}
          className="w-full rounded-md border bg-background px-2 py-1.5 text-sm" />
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-[14rem] flex-1">
            <SearchableCustomerSelect value={customerId} onChange={setCustomerId} onCustomerData={() => {}} />
          </div>
          {customerId && <Button variant="ghost" size="sm" onClick={() => setCustomerId(null)}>For everyone instead</Button>}
          <Button size="sm" onClick={add} disabled={adding || draft.trim().length < 3} loading={adding}>Add</Button>
        </div>
        <p className="text-xs text-muted-foreground">Leave the customer empty for a rule that applies to everything. Examples: {EXAMPLES.slice(1).map((e) => `“${e}”`).join(' ')}</p>
      </div>

      {err && <p className="text-sm text-destructive">{err}</p>}
      {rows === null && <p className="text-sm text-muted-foreground">Loading…</p>}
      {rows !== null && active.length === 0 && <p className="text-sm text-muted-foreground">Nothing learned yet. Add one above, or tell DB a preference in a conversation and say yes when she offers to remember it.</p>}
      {active.map(row)}
      {paused.length > 0 && (
        <details>
          <summary className="cursor-pointer text-xs text-muted-foreground">Paused ({paused.length}) — kept, but DB doesn’t use them</summary>
          <div className="mt-2 space-y-2">{paused.map(row)}</div>
        </details>
      )}
      <p className="text-xs text-muted-foreground">Cost: general learnings travel with every request. 20 of them add about ₹0.10 to the first reply of a conversation on Sonnet (under ₹0.01 on Haiku); within a conversation they are cached and cost almost nothing. Customer learnings cost nothing until that customer comes up.</p>
    </div>
  )
}
