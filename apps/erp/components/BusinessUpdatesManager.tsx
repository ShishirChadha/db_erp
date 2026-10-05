'use client'

import { useState } from 'react'
import { apiFetch } from '@/lib/api-client'
import { useAsyncAction } from '@/lib/useAsyncAction'
import { Button } from '@/components/ui/button'
import { Trash2 } from 'lucide-react'

export interface BusinessUpdate {
  id: string
  message: string
  created_at: string
}

// Owner-only publish/retire UI, rendered inline on the Home page beneath the
// updates feed every staff member sees. There is no separate settings page
// for this -- it's a handful of short broadcasts, not a module.
export function BusinessUpdatesManager({ initialUpdates, onChange }: {
  initialUpdates: BusinessUpdate[]
  onChange?: (updates: BusinessUpdate[]) => void
}) {
  const [updates, setUpdates] = useState(initialUpdates)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const publish = useAsyncAction(async () => {
    setError('')
    const trimmed = message.trim()
    if (!trimmed) return
    const res = await apiFetch('/api/business-updates', {
      method: 'POST',
      body: JSON.stringify({ message: trimmed }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError(json.error || 'Could not publish that update.')
      return
    }
    const next = [json.update, ...updates]
    setUpdates(next)
    onChange?.(next)
    setMessage('')
  })

  const retire = useAsyncAction(async (id: string) => {
    const res = await apiFetch(`/api/business-updates/${id}`, { method: 'DELETE' })
    if (!res.ok) return
    const next = updates.filter(u => u.id !== id)
    setUpdates(next)
    onChange?.(next)
  })

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <textarea
          value={message}
          onChange={e => setMessage(e.target.value)}
          placeholder="Publish an update everyone will see on their Home page..."
          rows={2}
          className="w-full rounded-md border border-input px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/25"
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
        <Button size="sm" onClick={publish.run} disabled={publish.pending || !message.trim()}>
          {publish.pending ? 'Publishing...' : 'Publish'}
        </Button>
      </div>

      {updates.length > 0 && (
        <ul className="space-y-1.5">
          {updates.map(u => (
            <li key={u.id} className="flex items-start justify-between gap-2 rounded-md border border-border px-3 py-2 text-xs">
              <span className="min-w-0">{u.message}</span>
              <button
                type="button"
                onClick={() => retire.run(u.id)}
                className="text-muted-foreground hover:text-destructive shrink-0"
                title="Retire this update"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
