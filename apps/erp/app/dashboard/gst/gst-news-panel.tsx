'use client'

import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, Newspaper, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { apiFetch } from '@/lib/api-client'

interface NewsItem {
  id: string
  url: string
  title: string
  published_on: string | null
  summary: string | null
  impact: 'action_required' | 'review' | 'info'
  erp_area: string | null
  suggested_action: string | null
  effective_date: string | null
  status: 'new' | 'seen'
  source_id: string | null
}
interface NewsSource {
  id: string; name: string; url: string; active: boolean; note: string | null
  last_run_at: string | null; last_status: string | null; last_error: string | null
}

const IMPACT: Record<NewsItem['impact'], { label: string; cls: string }> = {
  action_required: { label: 'Action needed', cls: 'bg-destructive/10 text-destructive border-destructive/30' },
  review: { label: 'Review', cls: 'bg-warning/10 text-warning border-warning/30' },
  info: { label: 'Info', cls: 'text-muted-foreground' },
}

const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : null)

export function GstNewsPanel() {
  const [items, setItems] = useState<NewsItem[]>([])
  const [sources, setSources] = useState<NewsSource[]>([])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await apiFetch('/api/gst/news')
      if (r.ok) {
        const d = await r.json()
        setItems(d.items ?? []); setSources(d.sources ?? [])
      }
    } finally { setLoaded(true) }
  }, [])
  useEffect(() => { load() }, [load])

  const checkNow = async () => {
    setBusy(true); setMsg('')
    try {
      const r = await apiFetch('/api/gst/news/run', { method: 'POST' })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { setMsg(d?.error || 'Check failed'); return }
      const rep: any[] = d.sources ?? []
      const added = rep.reduce((a, x) => a + (x.added || 0), 0)
      const bad = rep.filter((x) => x.status !== 'ok')
      setMsg(`${added} new update${added === 1 ? '' : 's'}.${bad.length ? ` ${bad.length} source${bad.length === 1 ? '' : 's'} could not be read — see below.` : ''}`)
      setOpen(true)
      await load()
    } finally { setBusy(false) }
  }

  const mark = async (id: string, status: 'actioned' | 'dismissed') => {
    const r = await apiFetch('/api/gst/news', { method: 'PATCH', body: JSON.stringify({ id, status }) })
    if (r.ok) setItems((prev) => prev.filter((i) => i.id !== id))
  }

  if (!loaded) return null
  const fresh = items.filter((i) => i.status === 'new')
  const urgent = items.filter((i) => i.impact === 'action_required')
  const lastRun = sources.map((s) => s.last_run_at).filter(Boolean).sort().pop() ?? null
  const unhealthy = sources.filter((s) => s.active && s.last_status && s.last_status !== 'ok')
  const hasContent = items.length > 0

  return (
    <div className={`rounded-lg border ${urgent.length ? 'border-destructive/40 bg-destructive/5' : 'bg-muted/30'}`}>
      <div className="flex items-center gap-3 px-3 py-2">
        <Newspaper className={`h-4 w-4 shrink-0 ${urgent.length ? 'text-destructive' : 'text-muted-foreground'}`} />
        <button
          type="button"
          className="flex-1 text-left text-sm cursor-pointer"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          <span className="font-medium">GST updates</span>
          <span className="text-muted-foreground">
            {hasContent
              ? ` · ${fresh.length} new${urgent.length ? ` · ${urgent.length} need${urgent.length === 1 ? 's' : ''} action` : ''}`
              : ' · nothing new'}
            {lastRun ? ` · checked ${fmt(lastRun)}` : ' · not checked yet'}
          </span>
          {open ? <ChevronUp className="inline h-4 w-4 ml-1" /> : <ChevronDown className="inline h-4 w-4 ml-1" />}
        </button>
        <Button size="sm" variant="outline" disabled={busy} onClick={checkNow} title="Fetch the official GST sources now">
          <RefreshCw className={busy ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} /> Check now
        </Button>
      </div>

      {open && (
        <div className="border-t px-3 py-3 space-y-3">
          {msg && <p className="text-sm">{msg}</p>}
          {!hasContent && <p className="text-sm text-muted-foreground">No open updates. The official sources are checked every morning (8:00 IST).</p>}

          {items.map((i) => (
            <div key={i.id} className="rounded-md border bg-background p-3 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className={IMPACT[i.impact].cls}>{IMPACT[i.impact].label}</Badge>
                {i.status === 'new' && <Badge variant="secondary">New</Badge>}
                {i.erp_area && <span className="text-xs text-muted-foreground">{i.erp_area.replace(/_/g, ' ')}</span>}
                {i.published_on && <span className="text-xs text-muted-foreground">· {fmt(i.published_on)}</span>}
                {i.effective_date && <span className="text-xs font-medium">· effective {fmt(i.effective_date)}</span>}
              </div>
              <a href={i.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium underline underline-offset-2">{i.title}</a>
              {i.summary && <p className="text-sm text-muted-foreground">{i.summary}</p>}
              {i.suggested_action && (
                <p className="text-sm"><span className="font-medium">What to do: </span>{i.suggested_action}</p>
              )}
              <div className="flex items-center justify-between pt-1">
                <span className="text-xs text-muted-foreground">AI summary — verify against the official notice.</span>
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" onClick={() => mark(i.id, 'actioned')}>Mark actioned</Button>
                  <Button size="sm" variant="ghost" onClick={() => mark(i.id, 'dismissed')}>Dismiss</Button>
                </div>
              </div>
            </div>
          ))}

          {sources.length > 0 && (
            <div className="text-xs text-muted-foreground space-y-0.5 pt-1">
              <p className="font-medium text-foreground">Sources watched</p>
              {sources.map((s) => (
                <p key={s.id}>
                  {s.name}:{' '}
                  {!s.active
                    ? <span>off{s.note ? ` — ${s.note}` : ''}</span>
                    : s.last_status === 'ok'
                      ? <span className="text-success">ok</span>
                      : s.last_status
                        ? <span className="text-destructive">{s.last_status}{s.last_error ? ` — ${s.last_error}` : ''}</span>
                        : <span>not run yet</span>}
                </p>
              ))}
              {unhealthy.length > 0 && (
                <p className="text-warning">A source that cannot be read means updates from it are NOT being checked.</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
