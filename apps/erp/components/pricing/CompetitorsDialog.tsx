'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { apiFetch } from '@/lib/api-client'
import { useAsyncAction } from '@/lib/useAsyncAction'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SimpleModal } from '@/components/SimpleModal'
import { Pill } from '@/components/MasterDetail'
import { timeAgo, type CompetitorInfo } from './types'

const SOURCE_LABEL: Record<string, string> = { shopify: 'Shopify price list', woocommerce: 'WooCommerce price list', jsonld: 'Product pages' }

function statusOf(c: CompetitorInfo): { tone: 'green' | 'amber' | 'red' | 'gray'; text: string } {
  const note = c.last_price_check_note || ''
  if (!c.price_enabled) return { tone: 'gray', text: 'Price checks off' }
  if (/^blocked/i.test(note)) return { tone: 'red', text: 'Blocks automated readers' }
  if (/^(error|unsupported)/i.test(note)) return { tone: 'amber', text: 'Last check failed' }
  if (!c.last_price_check_at) return { tone: 'gray', text: 'Not checked yet' }
  return { tone: 'green', text: 'Readable' }
}

// Add / remove / switch off the competitors whose prices appear on the Price Board.
// The list is shared with Website SEO -> Competitor websites.
export default function CompetitorsDialog({ open, onClose, onChanged }: { open: boolean; onClose: () => void; onChanged: () => void }) {
  const [list, setList] = useState<CompetitorInfo[]>([])
  const [label, setLabel] = useState('')
  const [url, setUrl] = useState('')
  const [warning, setWarning] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await apiFetch('/api/pricing/competitors')
    if (res.ok) setList(await res.json())
  }, [])
  useEffect(() => { if (open) { load(); setWarning(null) } }, [open, load])

  const { run: add, pending: adding } = useAsyncAction(async (confirm: boolean = false) => {
    setWarning(null)
    const res = await apiFetch('/api/pricing/competitors', { method: 'POST', body: JSON.stringify({ label, base_url: url, confirm_unreadable: confirm === true }) })
    const body = await res.json().catch(() => ({}))
    if (res.status === 409 && body.needs_confirmation) { setWarning(body.error || 'This website\'s prices cannot be read automatically.'); return }
    if (!res.ok) { toast.error(body.error || 'Could not add this website'); return }
    toast.success(body.probe?.status === 'ok' ? `Added. ${body.probe.message}` : 'Added, but its prices cannot be read automatically.')
    setLabel(''); setUrl('')
    await load(); onChanged()
  })

  const toggle = async (c: CompetitorInfo) => {
    const res = await apiFetch('/api/pricing/competitors', { method: 'PATCH', body: JSON.stringify({ id: c.id, price_enabled: !c.price_enabled }) })
    if (!res.ok) { toast.error('Could not update'); return }
    await load(); onChanged()
  }

  const remove = async (c: CompetitorInfo) => {
    if (!window.confirm(`Remove ${c.label}? Its stored prices, your “This model” decisions and its Website SEO analysis are deleted.`)) return
    const res = await apiFetch(`/api/pricing/competitors?id=${c.id}`, { method: 'DELETE' })
    if (!res.ok) { toast.error('Could not remove'); return }
    toast.success(`${c.label} removed`)
    await load(); onChanged()
  }

  return (
    <SimpleModal isOpen={open} onClose={onClose} title="Competitors" wide>
      <p className="mb-3 text-xs text-muted-foreground">Their public prices are read when you press “Check competitors”. The same list is used by Website SEO → Competitor websites.</p>
      <div className="space-y-2">
        {list.map((c) => {
          const st = statusOf(c)
          return (
            <div key={c.id} className="rounded-lg border p-2 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className="font-medium">{c.label}</span> <span className="break-all text-xs text-muted-foreground">{c.base_url.replace('https://', '')}</span>
                </div>
                <Pill tone={st.tone}>{st.text}</Pill>
              </div>
              <p className="mt-1 break-words text-xs text-muted-foreground">
                {c.listings > 0 ? `${c.listings} variants stored · checked ${timeAgo(c.last_price_check_at)}` : 'No prices stored'}
                {c.last_price_check_note ? ` · ${c.last_price_check_note.replace(/^(shopify|woocommerce|jsonld):\s*/, (m) => (SOURCE_LABEL[m.replace(/:\s*$/, '')] ?? m) + ': ')}` : ''}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="xs" variant="outline" onClick={() => toggle(c)}>{c.price_enabled ? 'Switch price checks off' : 'Switch price checks on'}</Button>
                <Button size="xs" variant="destructive" onClick={() => remove(c)}>Remove</Button>
              </div>
            </div>
          )
        })}
        {list.length === 0 && <p className="text-sm text-muted-foreground">No competitors yet.</p>}
      </div>

      <div className="mt-4 space-y-2 rounded-lg border p-3">
        <h3 className="text-sm font-semibold">Add a competitor</h3>
        <div className="grid gap-2 sm:grid-cols-2">
          <Input placeholder="Name, e.g. Edify" value={label} onChange={(e) => setLabel(e.target.value)} />
          <Input placeholder="Website, e.g. edify.club" value={url} onChange={(e) => setUrl(e.target.value)} />
        </div>
        {warning && (
          <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm">
            <p className="font-medium">Heads up: its prices cannot be read automatically.</p>
            <p className="mt-1 text-xs">{warning}</p>
            <p className="mt-1 text-xs">You can still add it (for the SEO analysis), but the Price Board will not show its prices.</p>
            <Button size="sm" variant="outline" className="mt-2" onClick={() => add(true)} disabled={adding}>Add anyway</Button>
          </div>
        )}
        <Button size="sm" onClick={() => add(false)} disabled={adding || !label.trim() || !url.trim()}>{adding ? 'Checking the site…' : 'Add competitor'}</Button>
      </div>
      <div className="mt-4 flex justify-end"><Button variant="outline" onClick={onClose}>Close</Button></div>
    </SimpleModal>
  )
}
