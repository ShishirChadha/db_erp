'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { apiFetch } from '@/lib/api-client'
import { SimpleMarkdown } from '@/lib/advisor/simple-markdown'
import { ErrorBanner } from '@/components/ErrorBanner'

interface Chapter {
  slug: string
  title: string
  kind: string
  summary: string
  body_md: string
  routes: string[]
  updated_at: string
}

export default function BibleChapterPage() {
  const params = useParams()
  const slug = params.slug as string
  const [chapter, setChapter] = useState<Chapter | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    apiFetch(`/api/advisor/bible/${encodeURIComponent(slug)}`)
      .then(async (res) => {
        const data = await res.json()
        if (cancelled) return
        if (!res.ok) { setError(data.error || 'Chapter not found'); return }
        setChapter(data)
      })
      .catch(() => !cancelled && setError('Failed to load chapter'))
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [slug])

  return (
    <div className="max-w-3xl mx-auto">
      <Link href="/dashboard" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
        <ChevronLeft className="h-4 w-4" /> Back
      </Link>
      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {error && <ErrorBanner message={error} />}
      {chapter && (
        <article>
          <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">{chapter.kind}</div>
          <h1 className="text-2xl font-bold mb-2">{chapter.title}</h1>
          {chapter.routes?.length > 0 && (
            <div className="mb-4 flex flex-wrap gap-2">
              {chapter.routes.map((r) => (
                <Link key={r} href={r} className="text-sm text-primary underline underline-offset-2">
                  Open {r}
                </Link>
              ))}
            </div>
          )}
          <SimpleMarkdown text={chapter.body_md} />
          <p className="mt-8 text-xs text-muted-foreground">Last updated {chapter.updated_at}</p>
        </article>
      )}
    </div>
  )
}
