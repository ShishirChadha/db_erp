'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch } from '@/lib/api-client'

const TAG_CATEGORY = 'activity_tags'

interface TagOption {
  id: string
  value: string
  is_active: boolean
}

// The pick-list a task's Tags field selects from -- staff can only choose from
// what's listed here, and only the owner can add a new one (enforced server-side
// in /api/custom-options' POST, not just hidden in this UI).
function AllowedTagsManager() {
  const [options, setOptions] = useState<TagOption[]>([])
  const [newValue, setNewValue] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [error, setError] = useState('')

  const fetchOptions = useCallback(async () => {
    setLoading(true)
    const res = await apiFetch(`/api/custom-options?category=${TAG_CATEGORY}&include_inactive=true`)
    setOptions(res.ok ? await res.json() : [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchOptions() }, [fetchOptions])

  const addTag = async () => {
    if (busyRef.current) return
    const value = newValue.trim()
    if (!value) return
    busyRef.current = true
    setBusy(true)
    setError('')
    try {
      const res = await apiFetch('/api/custom-options', { method: 'POST', body: JSON.stringify({ category: TAG_CATEGORY, value }) })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to add tag.')
      setNewValue('')
      await fetchOptions()
    } catch (e: any) {
      setError(e.message)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const toggleActive = async (opt: TagOption) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      await apiFetch(`/api/custom-options/${opt.id}`, { method: 'PATCH', body: JSON.stringify({ is_active: !opt.is_active }) })
      await fetchOptions()
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  return (
    <div className="mb-6">
      <h3 className="font-medium mb-1">Allowed Tags</h3>
      <p className="text-sm text-muted-foreground mb-3">
        The only tags staff can pick when tagging a task -- no free text. Deactivating a tag removes it from the picker
        without touching tasks that already have it.
      </p>

      {error && <div className="text-destructive text-sm mb-2">{error}</div>}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : (
        <div className="border rounded divide-y mb-3">
          {options.length === 0 && <p className="text-sm text-muted-foreground p-2">No allowed tags yet -- add one below.</p>}
          {options.map(opt => (
            <div key={opt.id} className="flex justify-between items-center p-2">
              <span className={opt.is_active ? '' : 'text-muted-foreground line-through'}>{opt.value}</span>
              <button
                onClick={() => toggleActive(opt)}
                disabled={busy}
                className={`text-xs px-2 py-1 rounded ${opt.is_active ? 'bg-destructive/10 text-destructive' : 'bg-success/15 text-success'}`}
              >
                {opt.is_active ? 'Deactivate' : 'Activate'}
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <input
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          placeholder="Add a new allowed tag..."
          className="border p-2 rounded flex-1"
          onKeyDown={(e) => { if (e.key === 'Enter') addTag() }}
        />
        <button onClick={addTag} disabled={busy} className="bg-primary text-primary-foreground px-4 py-2 rounded disabled:opacity-50">
          Add
        </button>
      </div>
    </div>
  )
}

// Legacy cleanup tool: tasks created before a tag was mandated to come from the
// Allowed Tags list above may still carry an old free-text spelling (or one that's
// since been deactivated there). This lets the owner fix a typo or merge it into
// another spelling across every task that uses it, or remove it entirely -- it
// operates on `activities.tags` directly, not on the Allowed Tags pick-list.
export default function TagsManager() {
  const [tags, setTags] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [error, setError] = useState('')

  const fetchTags = useCallback(async () => {
    setLoading(true)
    const res = await apiFetch('/api/tags')
    setTags(res.ok ? await res.json() : [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchTags() }, [fetchTags])

  const renameTag = async (tag: string) => {
    const next = window.prompt(`Rename tag "${tag}" to:`, tag)
    if (next === null) return
    const trimmed = next.trim()
    if (!trimmed || trimmed === tag) return
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError('')
    try {
      const res = await apiFetch('/api/tags', {
        method: 'PATCH',
        body: JSON.stringify({ oldTag: tag, newTag: trimmed }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to rename.')
      await fetchTags()
    } catch (e: any) {
      setError(e.message)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const deleteTag = async (tag: string) => {
    if (!window.confirm(`Remove tag "${tag}" from every task that uses it? This can't be undone.`)) return
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError('')
    try {
      const res = await apiFetch('/api/tags', {
        method: 'PATCH',
        body: JSON.stringify({ oldTag: tag, newTag: null }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to delete.')
      await fetchTags()
    } catch (e: any) {
      setError(e.message)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  return (
    <div>
      <AllowedTagsManager />

      <h3 className="font-medium mb-1">Existing Tag Cleanup</h3>
      <p className="text-sm text-muted-foreground mb-4">
        Rename a tag already used on a task to fix a typo or merge it into another spelling everywhere it&apos;s
        used, or remove it entirely. This only affects tags already saved on a task -- it does not change the
        Allowed Tags list above.
      </p>

      {error && <div className="text-destructive text-sm mb-2">{error}</div>}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : (
        <div className="border rounded divide-y">
          {tags.length === 0 && <p className="text-sm text-muted-foreground p-2">No tags in use yet.</p>}
          {tags.map(tag => (
            <div key={tag} className="flex justify-between items-center p-2">
              <span>{tag}</span>
              <div className="flex gap-2">
                <button
                  onClick={() => renameTag(tag)}
                  disabled={busy}
                  className="text-xs px-2 py-1 rounded bg-info/15 text-primary disabled:opacity-50"
                >
                  Rename
                </button>
                <button
                  onClick={() => deleteTag(tag)}
                  disabled={busy}
                  className="text-xs px-2 py-1 rounded bg-destructive/10 text-destructive disabled:opacity-50"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
