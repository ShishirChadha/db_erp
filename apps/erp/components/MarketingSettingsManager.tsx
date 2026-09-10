'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api-client'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { ErrorBanner } from '@/components/ErrorBanner'
import { useAsyncAction } from '@/lib/useAsyncAction'

interface MarketingSettings {
  brand_voice: string | null
  default_cta: string | null
  contact_block: string | null
  hashtag_bank: string[]
  disclaimer: string | null
  daily_generation_cap: number
  whatsapp_flavor_lines: string[]
  default_warranty_label: string | null
}

// Owner-only defaults for the Marketing Content Studio's AI generator -- brand
// voice, standard CTA/contact block appended to every generated post, a shared
// hashtag bank, and a daily AI-call cap (cost control, same posture as the owner
// confirm:true gate on Tier 2 recon extraction).
export default function MarketingSettingsManager() {
  const [settings, setSettings] = useState<MarketingSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hashtagInput, setHashtagInput] = useState('')
  const [flavorLinesInput, setFlavorLinesInput] = useState('')

  const load = async () => {
    setLoading(true)
    const res = await apiFetch('/api/settings/marketing')
    if (res.ok) {
      const data = await res.json()
      setSettings(data)
      setHashtagInput((data.hashtag_bank || []).join(', '))
      setFlavorLinesInput((data.whatsapp_flavor_lines || []).join('\n'))
    } else {
      setError('Failed to load marketing settings')
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const { run: save, pending: saving } = useAsyncAction(async () => {
    if (!settings) return
    setError(null)
    try {
      const res = await apiFetch('/api/settings/marketing', {
        method: 'PUT',
        body: JSON.stringify({
          ...settings,
          hashtag_bank: hashtagInput.split(',').map((h) => h.trim().replace(/^#/, '')).filter(Boolean),
          whatsapp_flavor_lines: flavorLinesInput.split('\n').map((l) => l.trim()).filter(Boolean),
        }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to save')
      await load()
    } catch (err: any) {
      setError(err.message || 'Failed to save')
    }
  })

  if (loading) return <p className="text-sm text-muted-foreground">Loading...</p>
  if (!settings) return <ErrorBanner message={error || 'Could not load settings'} />

  return (
    <div className="space-y-5 max-w-2xl">
      <div>
        <label className="text-sm font-medium mb-1 block">Brand voice</label>
        <Textarea
          value={settings.brand_voice || ''}
          onChange={(e) => setSettings({ ...settings, brand_voice: e.target.value })}
          placeholder="e.g. Friendly, trustworthy, a little energetic -- speaks to value-conscious buyers considering refurbished tech."
          rows={3}
        />
      </div>
      <div>
        <label className="text-sm font-medium mb-1 block">Default call-to-action</label>
        <Input
          value={settings.default_cta || ''}
          onChange={(e) => setSettings({ ...settings, default_cta: e.target.value })}
          placeholder="e.g. DM us or call to book yours"
        />
      </div>
      <div>
        <label className="text-sm font-medium mb-1 block">Contact block (appended to every generated post)</label>
        <Textarea
          value={settings.contact_block || ''}
          onChange={(e) => setSettings({ ...settings, contact_block: e.target.value })}
          placeholder={'📞 +91 99911 11193\n📍 Greater Noida'}
          rows={3}
        />
      </div>
      <div>
        <label className="text-sm font-medium mb-1 block">Hashtag bank (comma-separated, used for Instagram/Facebook captions)</label>
        <Input value={hashtagInput} onChange={(e) => setHashtagInput(e.target.value)} placeholder="refurbishedlaptops, greaternoida, digitalbluez" />
      </div>
      <div>
        <label className="text-sm font-medium mb-1 block">WhatsApp flavor lines (one per line -- rotated into the 💫 bullets on single-product messages)</label>
        <Textarea
          value={flavorLinesInput}
          onChange={(e) => setFlavorLinesInput(e.target.value)}
          placeholder={'Smooth Experience\nFast Boot & Reliable Performance'}
          rows={4}
        />
      </div>
      <div>
        <label className="text-sm font-medium mb-1 block">Default warranty label (used when a unit has no warranty months recorded yet)</label>
        <Input
          value={settings.default_warranty_label || ''}
          onChange={(e) => setSettings({ ...settings, default_warranty_label: e.target.value })}
          placeholder="6 Months Warranty"
        />
      </div>
      <div>
        <label className="text-sm font-medium mb-1 block">Extra generation rule (optional)</label>
        <Textarea
          value={settings.disclaimer || ''}
          onChange={(e) => setSettings({ ...settings, disclaimer: e.target.value })}
          placeholder="e.g. Never claim next-day delivery."
          rows={2}
        />
      </div>
      <div>
        <label className="text-sm font-medium mb-1 block">Daily AI-generation cap</label>
        <Input
          type="number"
          min={1}
          className="w-32"
          value={settings.daily_generation_cap}
          onChange={(e) => setSettings({ ...settings, daily_generation_cap: Number(e.target.value) })}
        />
        <p className="text-xs text-muted-foreground mt-1">Each generated draft costs a small Anthropic API call. This caps how many can be generated per day.</p>
      </div>
      {error && <ErrorBanner message={error} />}
      <Button onClick={save} disabled={saving} className="h-8">{saving ? 'Saving...' : 'Save'}</Button>
    </div>
  )
}
