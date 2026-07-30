'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch } from '@/lib/api-client'

// Activity tags are free-text (activities.tags is a text[], no normalized table) --
// this lets the owner fix a typo'd tag (or merge it into another spelling, or remove
// it) across every task that uses it in one action, instead of editing each task
// individually.
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
      <p className="text-sm text-gray-600 mb-4">
        Tags are added freely by anyone on the Activity Hub. Rename one here to fix a typo or merge it into
        another spelling everywhere it&apos;s used, or remove it entirely.
      </p>

      {error && <div className="text-red-600 text-sm mb-2">{error}</div>}

      {loading ? (
        <p className="text-sm text-gray-400">Loading...</p>
      ) : (
        <div className="border rounded divide-y">
          {tags.length === 0 && <p className="text-sm text-gray-400 p-2">No tags in use yet.</p>}
          {tags.map(tag => (
            <div key={tag} className="flex justify-between items-center p-2">
              <span>{tag}</span>
              <div className="flex gap-2">
                <button
                  onClick={() => renameTag(tag)}
                  disabled={busy}
                  className="text-xs px-2 py-1 rounded bg-blue-50 text-blue-600 disabled:opacity-50"
                >
                  Rename
                </button>
                <button
                  onClick={() => deleteTag(tag)}
                  disabled={busy}
                  className="text-xs px-2 py-1 rounded bg-red-50 text-red-600 disabled:opacity-50"
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
