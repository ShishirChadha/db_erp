// A deliberately minimal markdown-to-JSX renderer for Bible chapters. Not a
// general-purpose parser; do not reuse this for arbitrary markdown.
//
// Supports headings, bold, inline code, lists, fenced code blocks and tables.
// The last two were added on 2026-10-01: chapters had grown tables, and the
// architecture chapters contain ASCII diagrams. Without fence support every
// diagram line became its own paragraph with its whitespace collapsed, so the
// diagrams were unreadable in the DB Guide while looking fine in the repo --
// and table rows rendered as raw pipe characters.
//
// A numbered list directly under a "## Steps" (or "### Steps") heading
// renders as a connected step-flow (numbered badges + a vertical connecting
// line + a small per-step icon guessed from its leading verb) instead of a
// plain <ol> -- a real screenshot-free "infographic" look, derived entirely
// from the chapter's own existing text. No new authoring step, nothing to go
// stale: it re-renders from whatever the chapter already says, so it can
// never drift independently of the prose bible:check already guards.
import React from 'react'
import {
  ArrowRight,
  MousePointerClick,
  Keyboard,
  Search as SearchIcon,
  ListChecks,
  Check,
  Upload,
  type LucideIcon,
} from 'lucide-react'

function stepIcon(text: string): LucideIcon | null {
  const t = text.trim()
  if (/^(open|go to|navigate to)\b/i.test(t)) return ArrowRight
  if (/^(tap|click|press)\b/i.test(t)) return MousePointerClick
  if (/^(enter|type|fill)\b/i.test(t)) return Keyboard
  if (/^(search|look up|find)\b/i.test(t)) return SearchIcon
  if (/^(select|pick|choose)\b/i.test(t)) return ListChecks
  if (/^(confirm|submit|save)\b/i.test(t)) return Check
  if (/^(upload|attach)\b/i.test(t)) return Upload
  return null
}

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
  let listType: 'ul' | 'ol' | null = null
  let fenceBuf: string[] | null = null   // inside a ``` block
  let tableBuf: string[] = []
  let inStepsSection = false   // true while under a "## Steps" / "### Steps" heading

  const flushList = (key: string) => {
    if (listBuf.length === 0) return
    if (listType === 'ol' && inStepsSection) {
      blocks.push(
        <ol key={key} className="my-4">
          {listBuf.map((item, i) => {
            const Icon = stepIcon(item)
            const isLast = i === listBuf.length - 1
            return (
              <li key={i} className="relative flex gap-3 pb-6 last:pb-0">
                {!isLast && (
                  <span className="absolute left-[15px] top-8 bottom-0 w-px bg-border" aria-hidden="true" />
                )}
                <span className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                  {i + 1}
                </span>
                <div className="flex flex-1 items-start gap-2 pt-1">
                  {Icon && <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
                  <span className="leading-relaxed">{renderInline(item, `${key}-${i}`)}</span>
                </div>
              </li>
            )
          })}
        </ol>
      )
      listBuf = []
      listType = null
      return
    }
    const items = listBuf.map((item, i) => <li key={i}>{renderInline(item, `${key}-${i}`)}</li>)
    blocks.push(
      listType === 'ol'
        ? <ol key={key} className="list-decimal space-y-1 pl-6 my-2">{items}</ol>
        : <ul key={key} className="list-disc space-y-1 pl-6 my-2">{items}</ul>
    )
    listBuf = []
    listType = null
  }

  // A table is rendered only once its run of pipe rows ends, since we cannot
  // know the column count until then.
  const flushTable = (key: string) => {
    if (tableBuf.length === 0) return
    const cells = (row: string) =>
      row.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim())
    // A separator row (|---|---|) marks the row above it as the header.
    const sepIdx = tableBuf.findIndex(r => /^\s*\|?[\s:-]*-[\s|:-]*$/.test(r))
    const headerRows = sepIdx > 0 ? tableBuf.slice(0, sepIdx) : []
    const bodyRows = tableBuf.filter((_, i) => i !== sepIdx).slice(headerRows.length)
    blocks.push(
      <div key={key} className="my-3 overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          {headerRows.length > 0 && (
            <thead>
              {headerRows.map((r, ri) => (
                <tr key={ri} className="border-b bg-muted/40 text-left">
                  {cells(r).map((c, ci) => (
                    <th key={ci} className="px-3 py-1.5 font-medium">{renderInline(c, `${key}-h-${ri}-${ci}`)}</th>
                  ))}
                </tr>
              ))}
            </thead>
          )}
          <tbody>
            {bodyRows.map((r, ri) => (
              <tr key={ri} className="border-b last:border-0 align-top">
                {cells(r).map((c, ci) => (
                  <td key={ci} className="px-3 py-1.5">{renderInline(c, `${key}-c-${ri}-${ci}`)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
    tableBuf = []
  }

  lines.forEach((line, i) => {
    const key = `b-${i}`

    // Fenced code / ASCII diagram. Whitespace must survive verbatim, so this is
    // checked before anything else -- a diagram line can legally start with '#'
    // or '-' and must not be mistaken for a heading or a list item.
    if (/^\s*```/.test(line)) {
      if (fenceBuf === null) {
        flushList(`${key}-l`); flushTable(`${key}-t`)
        fenceBuf = []
      } else {
        blocks.push(
          <pre key={key} className="my-3 overflow-x-auto rounded-md border bg-muted/40 p-3 text-xs leading-snug">
            <code className="font-mono whitespace-pre">{fenceBuf.join('\n')}</code>
          </pre>
        )
        fenceBuf = null
      }
      return
    }
    if (fenceBuf !== null) { fenceBuf.push(line); return }

    // Table rows: buffer the whole run, then render.
    if (/^\s*\|.*\|\s*$/.test(line)) {
      flushList(`${key}-l`)
      tableBuf.push(line)
      return
    }
    if (tableBuf.length > 0) flushTable(`${key}-t`)

    if (/^##\s+/.test(line)) {
      flushList(`${key}-l`)
      const headingText = line.replace(/^##\s+/, '')
      inStepsSection = /^steps\b/i.test(headingText.trim())
      blocks.push(<h3 key={key} className="text-lg font-semibold mt-6 mb-2">{headingText}</h3>)
    } else if (/^###\s+/.test(line)) {
      flushList(`${key}-l`)
      const headingText = line.replace(/^###\s+/, '')
      inStepsSection = /^steps\b/i.test(headingText.trim())
      blocks.push(<h4 key={key} className="text-base font-semibold mt-4 mb-1">{headingText}</h4>)
    } else if (/^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line)) {
      const isOrdered = /^\d+\.\s+/.test(line)
      if (listType && listType !== (isOrdered ? 'ol' : 'ul')) flushList(`${key}-l`)
      listType = isOrdered ? 'ol' : 'ul'
      listBuf.push(line.replace(isOrdered ? /^\d+\.\s+/ : /^[-*]\s+/, ''))
    } else if (line.trim() === '') {
      flushList(`${key}-l`)
    } else {
      flushList(`${key}-l`)
      blocks.push(<p key={key} className="my-2 leading-relaxed">{renderInline(line, key)}</p>)
    }
  })
  flushList('end-l')
  flushTable('end-t')
  // An unterminated fence still renders, rather than silently swallowing the
  // rest of the chapter. The cast is needed because TypeScript does not track
  // assignments made inside the forEach callback, so out here it still believes
  // fenceBuf holds its initial `null` -- which makes the truthy branch `never`.
  const trailingFence = fenceBuf as unknown as string[] | null
  if (trailingFence && trailingFence.length > 0) {
    blocks.push(
      <pre key="end-fence" className="my-3 overflow-x-auto rounded-md border bg-muted/40 p-3 text-xs leading-snug">
        <code className="font-mono whitespace-pre">{trailingFence.join('\n')}</code>
      </pre>
    )
  }

  return <div>{blocks}</div>
}
