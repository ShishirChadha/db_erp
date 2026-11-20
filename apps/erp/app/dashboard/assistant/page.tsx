'use client'

import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import RequireOwner from '@/components/RequireOwner'
import { Panes, ListItem, ListHeader } from '@/components/MasterDetail'
import { Button } from '@/components/ui/button'
import { apiFetch } from '@/lib/api-client'

// What DB has done and what she remembers. Conversations are newest first;
// "Remembered" lists every note she was asked to keep, each removable.
type ThreadRow = { id: string; title: string | null; created_at: string; updated_at: string }
type Note = { id: string; subject_type: string; note: string; created_at: string; customers: { customer_name: string } | null }

const fmt = (d: string) => new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

export default function AssistantPage() {
  const [threads, setThreads] = useState<ThreadRow[]>([])
  const [notes, setNotes] = useState<Note[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [detail, setDetail] = useState<{ transcript: { role: string; text: string }[] } | null>(null)

  const loadNotes = () => apiFetch('/api/assistant/notes').then((r) => r.json()).then((j) => setNotes(Array.isArray(j) ? j : []))
  useEffect(() => {
    apiFetch('/api/assistant/threads').then((r) => r.json()).then((j) => setThreads(Array.isArray(j) ? j : []))
    loadNotes()
  }, [])
  useEffect(() => {
    if (!active || active === 'notes') { setDetail(null); return }
    apiFetch(`/api/assistant/threads?id=${active}`).then((r) => r.json()).then(setDetail)
  }, [active])

  const forget = async (id: string) => {
    await apiFetch(`/api/assistant/notes?id=${id}`, { method: 'DELETE' })
    loadNotes()
  }

  return (
    <RequireOwner>
      <div className="space-y-4">
        <div>
          <h1 className="text-xl font-semibold">DB — your assistant</h1>
          <p className="text-sm text-muted-foreground">Talk to her with the button at the bottom right of any page. Everything she saves shows “DB” as the creator.</p>
        </div>
        <Panes
          open={!!active}
          onBack={() => setActive(null)}
          list={
            <div className="space-y-1">
              <ListItem selected={active === 'notes'} onClick={() => setActive('notes')} title="What DB remembers" sub={`${notes.length} note${notes.length === 1 ? '' : 's'}`} />
              <ListHeader title="Conversations" />
              {threads.length === 0 && <p className="px-2 text-sm text-muted-foreground">No conversations yet.</p>}
              {threads.map((t) => (
                <ListItem key={t.id} selected={active === t.id} onClick={() => setActive(t.id)} title={t.title || 'Conversation'} sub={fmt(t.updated_at)} />
              ))}
            </div>
          }
        >
          {active === 'notes' ? (
            <div className="space-y-2">
              {notes.length === 0 && <p className="text-sm text-muted-foreground">Nothing yet. When you tell DB a preference, she offers to remember it.</p>}
              {notes.map((n) => (
                <div key={n.id} className="flex items-start justify-between gap-3 rounded-md border p-3 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">{fmt(n.created_at)} · {n.customers?.customer_name || 'General'}</p>
                    <p>{n.note}</p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => forget(n.id)} aria-label="Forget this"><Trash2 className="h-4 w-4" /></Button>
                </div>
              ))}
            </div>
          ) : detail ? (
            <div className="space-y-2">
              {detail.transcript.map((m, i) => (
                <div key={i} className={m.role === 'owner' ? 'text-right' : ''}>
                  <span className={`inline-block max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${m.role === 'owner' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>{m.text}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Pick a conversation.</p>
          )}
        </Panes>
      </div>
    </RequireOwner>
  )
}
