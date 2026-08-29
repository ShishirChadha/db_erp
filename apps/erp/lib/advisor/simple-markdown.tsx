// A deliberately minimal markdown-to-JSX renderer -- Bible chapters are clean,
// hand-written markdown using only headings/bold/lists/paragraphs (see any file in
// docs/bible/**), so a real markdown library is unnecessary weight for one reader
// page. Not a general-purpose parser; do not reuse this for arbitrary markdown.
import React from 'react'

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={`${keyPrefix}-${i}`}>{part.slice(2, -2)}</strong>
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={`${keyPrefix}-${i}`} className="rounded bg-muted px-1 py-0.5 text-sm">{part.slice(1, -1)}</code>
    }
    return <React.Fragment key={`${keyPrefix}-${i}`}>{part}</React.Fragment>
  })
}

export function SimpleMarkdown({ text }: { text: string }) {
  const lines = text.split('\n')
  const blocks: React.ReactNode[] = []
  let listBuf: string[] = []

  const flushList = (key: string) => {
    if (listBuf.length === 0) return
    blocks.push(
      <ul key={key} className="list-disc space-y-1 pl-6 my-2">
        {listBuf.map((item, i) => <li key={i}>{renderInline(item, `${key}-${i}`)}</li>)}
      </ul>
    )
    listBuf = []
  }

  lines.forEach((line, i) => {
    const key = `b-${i}`
    if (/^##\s+/.test(line)) {
      flushList(`${key}-l`)
      blocks.push(<h3 key={key} className="text-lg font-semibold mt-6 mb-2">{line.replace(/^##\s+/, '')}</h3>)
    } else if (/^###\s+/.test(line)) {
      flushList(`${key}-l`)
      blocks.push(<h4 key={key} className="text-base font-semibold mt-4 mb-1">{line.replace(/^###\s+/, '')}</h4>)
    } else if (/^[-*]\s+/.test(line)) {
      listBuf.push(line.replace(/^[-*]\s+/, ''))
    } else if (/^\d+\.\s+/.test(line)) {
      listBuf.push(line.replace(/^\d+\.\s+/, ''))
    } else if (line.trim() === '') {
      flushList(`${key}-l`)
    } else {
      flushList(`${key}-l`)
      blocks.push(<p key={key} className="my-2 leading-relaxed">{renderInline(line, key)}</p>)
    }
  })
  flushList('end-l')

  return <div>{blocks}</div>
}
