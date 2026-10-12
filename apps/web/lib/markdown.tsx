import type { ReactNode } from 'react'
import Link from 'next/link'

// A small, dependency-free Markdown renderer for blog posts. It builds React
// elements (never HTML strings), so post text can't inject markup or script;
// links and images are limited to https:, mailto: and site-relative URLs.
// Supported: # / ## / ### headings, paragraphs, - and 1. lists, > quotes, ---,
// **bold**, *italic*, [text](url), ![alt](url). A post written as plain text
// (blank-line paragraphs, single newlines) still reads the way it always did.

function safeUrl(url: string): string | null {
  const u = url.trim()
  if (u.startsWith('/') && !u.startsWith('//')) return u
  if (/^https:\/\//i.test(u) || /^mailto:/i.test(u)) return u
  return null
}

const INLINE = /(!\[([^\]]*)\]\(([^)\s]+)\)|\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|\*([^*\n]+)\*)/g

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let n = 0
  for (const m of text.matchAll(INLINE)) {
    const start = m.index ?? 0
    if (start > last) out.push(text.slice(last, start))
    const key = `${keyPrefix}-${n++}`
    if (m[2] !== undefined && m[3]) {
      const src = safeUrl(m[3])
      // eslint-disable-next-line @next/next/no-img-element
      out.push(src ? <img key={key} src={src} alt={m[2]} loading="lazy" className="my-4 h-auto max-w-full rounded-lg" /> : m[0])
    } else if (m[4] !== undefined && m[5]) {
      const href = safeUrl(m[5])
      if (!href) out.push(m[4])
      else if (href.startsWith('/')) out.push(<Link key={key} href={href} className="text-brand-orange underline">{m[4]}</Link>)
      else out.push(<a key={key} href={href} rel="noopener noreferrer" className="text-brand-orange underline">{m[4]}</a>)
    } else if (m[6] !== undefined) {
      out.push(<strong key={key}>{m[6]}</strong>)
    } else if (m[7] !== undefined) {
      out.push(<em key={key}>{m[7]}</em>)
    }
    last = start + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

// Single newlines inside a paragraph become line breaks (plain-text posts).
function renderLines(text: string, keyPrefix: string): ReactNode[] {
  return text.split('\n').flatMap((line, i, arr) => [
    ...renderInline(line, `${keyPrefix}-${i}`),
    ...(i < arr.length - 1 ? [<br key={`${keyPrefix}-br-${i}`} />] : []),
  ])
}

export function MarkdownBody({ source }: { source: string }) {
  const blocks = source.replace(/\r\n/g, '\n').trim().split(/\n{2,}/)
  return (
    <div className="mt-8 space-y-4 text-sm leading-relaxed text-foreground">
      {blocks.map((block, i) => {
        const key = `b${i}`
        const heading = block.match(/^(#{1,3})\s+(.+)$/)
        if (heading) {
          const level = heading[1].length
          const cls = level === 1 ? 'text-2xl' : level === 2 ? 'text-xl' : 'text-lg'
          // The post title is the page's H1, so body headings start at H2.
          const Tag = level === 3 ? 'h3' : 'h2'
          return <Tag key={key} className={`font-heading ${cls} font-bold tracking-tight pt-2`}>{renderInline(heading[2], key)}</Tag>
        }
        if (/^---+$/.test(block.trim())) return <hr key={key} className="border-border" />
        const lines = block.split('\n')
        if (lines.every((l) => /^[-*]\s+/.test(l))) {
          return <ul key={key} className="list-disc space-y-1 pl-5">{lines.map((l, j) => <li key={j}>{renderInline(l.replace(/^[-*]\s+/, ''), `${key}-${j}`)}</li>)}</ul>
        }
        if (lines.every((l) => /^\d+[.)]\s+/.test(l))) {
          return <ol key={key} className="list-decimal space-y-1 pl-5">{lines.map((l, j) => <li key={j}>{renderInline(l.replace(/^\d+[.)]\s+/, ''), `${key}-${j}`)}</li>)}</ol>
        }
        if (lines.every((l) => /^>\s?/.test(l))) {
          return <blockquote key={key} className="border-l-2 border-border pl-4 italic text-muted-foreground">{renderLines(lines.map((l) => l.replace(/^>\s?/, '')).join('\n'), key)}</blockquote>
        }
        return <p key={key}>{renderLines(block, key)}</p>
      })}
    </div>
  )
}
