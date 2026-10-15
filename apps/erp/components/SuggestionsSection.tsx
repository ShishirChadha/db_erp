'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api-client'
import { ListHeader, ListItem, Panes, Pill } from '@/components/MasterDetail'
import type { Suggestion } from '@/lib/seo-suggestions'

// Settings -> Website SEO -> Suggestions and Google setup. Both read the live
// measurements from /api/website-seo/suggestions (the website's own pages, the
// stock, the collections, 404s, crawl and keyword data) -- nothing is guessed.

const btnPrimary = 'bg-primary text-primary-foreground px-4 py-2 rounded text-sm disabled:opacity-50'
const btnGhost = 'border px-3 py-2 rounded text-sm hover:bg-muted disabled:opacity-50'
const errorOf = (res: Response, fallback: string) => res.json().then((j) => j.error || fallback).catch(() => fallback)

export interface GoogleStatus {
  homepageFetched: boolean
  gaIdOnSite: string | null
  gaIdLooksValid: boolean
  verificationMetaFound: boolean
  sitemapOk: boolean
  gscConfigured: boolean
  ga4Configured: boolean
  serviceAccountEmail: string | null
  expectedMeasurementId: string | null
  gscSiteUrl: string | null
  propertyIdSet: boolean
}

interface Payload { generated_at: string; suggestions: Suggestion[]; hidden: number; google: GoogleStatus }

function useSuggestions() {
  const [data, setData] = useState<Payload | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const load = useCallback(async () => {
    setLoading(true)
    const res = await apiFetch('/api/website-seo/suggestions')
    if (res.ok) { setData(await res.json()); setError('') } else setError(await errorOf(res, 'Could not load suggestions'))
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])
  return { data, error, loading, reload: load }
}

const SEV_TONE = { high: 'red', medium: 'amber', low: 'gray' } as const
const SEV_LABEL = { high: 'Do first', medium: 'Soon', low: 'When you can' } as const
const AREAS = ['Google setup', 'Google Business Profile', 'Collections', 'Content', 'Technical', 'Keywords', 'Competitors'] as const

export function SuggestionsSection({ go }: { go: (tab: any) => void }) {
  const { data, error, loading, reload } = useSuggestions()
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [area, setArea] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')

  const list = (data?.suggestions ?? []).filter((s) => !area || s.area === area)
  const selected = list.find((s) => s.key === selectedKey) ?? null

  const act = async (action: 'done' | 'snooze' | 'dismiss', days?: number) => {
    if (!selected) return
    setBusy(true); setActionError('')
    const res = await apiFetch('/api/website-seo/suggestions', { method: 'POST', body: JSON.stringify({ key: selected.key, action, days }) })
    if (res.ok) { setSelectedKey(null); setOpen(false); await reload() } else setActionError(await errorOf(res, 'Could not save'))
    setBusy(false)
  }

  return (
    <Panes
      bp="xl"
      open={open}
      onBack={() => setOpen(false)}
      backLabel="Back to suggestions"
      list={
        <div>
          <ListHeader title={`${list.length} to do`} onNew={reload} newLabel="Refresh" />
          <select className="mb-2 w-full rounded border bg-background p-2 text-sm" value={area} onChange={(e) => setArea(e.target.value)}>
            <option value="">All areas</option>
            {AREAS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          {loading ? <p className="text-sm text-muted-foreground">Checking your website and data…</p> : error ? <p className="text-sm text-destructive">{error}</p> : list.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing to do right now{data?.hidden ? ` (${data.hidden} snoozed or done)` : ''}.</p>
          ) : (
            <div className="space-y-1">
              {list.map((s) => (
                <ListItem
                  key={s.key}
                  selected={s.key === selectedKey}
                  onClick={() => { setSelectedKey(s.key); setOpen(true); setActionError('') }}
                  title={s.title}
                  sub={s.area}
                  right={<Pill tone={SEV_TONE[s.severity]}>{SEV_LABEL[s.severity]}</Pill>}
                />
              ))}
            </div>
          )}
        </div>
      }
    >
      <p className="mb-4 text-sm text-muted-foreground">
        Each item appears only because something measured today says so: your live site, your stock, your collections, dead links,
        your crawl and keyword data, and what competitors do. Google Business Profile items are reminders, since Google does not let
        this tool read or edit your profile. A weekly task in Activities points you here.
      </p>
      {!selected ? (
        <p className="text-sm text-muted-foreground">Choose an item on the left.</p>
      ) : (
        <div className="max-w-xl space-y-4">
          <div>
            <div className="mb-1 flex items-center gap-2"><Pill tone={SEV_TONE[selected.severity]}>{SEV_LABEL[selected.severity]}</Pill><span className="text-xs text-muted-foreground">{selected.area}{selected.everyDays ? ` · comes back every ${selected.everyDays} days` : ''}</span></div>
            <h3 className="text-base font-semibold">{selected.title}</h3>
          </div>
          <div><div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Why it matters</div><p className="mt-1 text-sm">{selected.why}</p></div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">What to do</div>
            <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm">{selected.how.map((h) => <li key={h}>{h}</li>)}</ol>
          </div>
          {selected.screen && <button className="text-sm text-primary hover:underline" onClick={() => go(selected.screen)}>Open the related screen →</button>}
          {actionError && <div className="text-sm text-destructive">{actionError}</div>}
          <div className="flex flex-wrap gap-2 border-t pt-4">
            <button className={btnPrimary} disabled={busy} onClick={() => act('done')}>Mark done</button>
            <button className={btnGhost} disabled={busy} onClick={() => act('snooze', 7)}>Remind me in a week</button>
            <button className={btnGhost} disabled={busy} onClick={() => act('dismiss')}>Not relevant</button>
          </div>
          <p className="text-xs text-muted-foreground">
            “Done” hides it and checks again later; if the problem is still there it returns. “Not relevant” hides it for
            {selected.everyDays ? ' this cycle' : ' 90 days'}.
          </p>
        </div>
      )}
    </Panes>
  )
}

// ---------------------------------------------------------------- Google setup

function Check({ ok, warn, title, detail }: { ok: boolean; warn?: boolean; title: string; detail: React.ReactNode }) {
  const tone = ok ? 'text-green-700' : warn ? 'text-amber-600' : 'text-destructive'
  return (
    <div className="flex gap-3 rounded-lg border p-3">
      <span className={`mt-0.5 text-lg leading-none ${tone}`}>{ok ? '✓' : warn ? '!' : '✕'}</span>
      <div className="min-w-0">
        <div className="text-sm font-medium">{title}</div>
        <div className="break-words text-sm text-muted-foreground">{detail}</div>
      </div>
    </div>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <details className="rounded-lg border p-3" open={n === 1}>
      <summary className="cursor-pointer text-sm font-medium">{n}. {title}</summary>
      <div className="mt-2 space-y-1 text-sm text-muted-foreground">{children}</div>
    </details>
  )
}

export function GoogleSetupSection() {
  const { data, error, loading, reload } = useSuggestions()
  const g = data?.google

  if (loading) return <p className="text-sm text-muted-foreground">Checking your live website…</p>
  if (error || !g) return <p className="text-sm text-destructive">{error || 'Could not run the checks'}</p>

  const idMismatch = !!g.gaIdOnSite && !!g.expectedMeasurementId && g.gaIdOnSite !== g.expectedMeasurementId

  return (
    <div className="max-w-2xl space-y-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Live checks of your website and this ERP&apos;s Google connection.</p>
        <button className={btnGhost} onClick={reload}>Check again</button>
      </div>

      <div className="space-y-2">
        <Check ok={g.homepageFetched} title="The live website responds" detail={g.homepageFetched ? 'Home page loaded.' : 'The home page could not be loaded, so the checks below could not run.'} />
        <Check
          ok={g.gaIdLooksValid && !idMismatch}
          warn={g.gaIdLooksValid && idMismatch}
          title="Google Analytics tag on the live site"
          detail={
            !g.homepageFetched ? 'Not checked.'
            : !g.gaIdOnSite ? 'No Analytics tag found on the home page. Visits are not being measured.'
            : !g.gaIdLooksValid ? <>The site uses <b>{g.gaIdOnSite}</b>, which is not a valid ID. A GA4 ID is “G-” followed by exactly 10 letters or digits, so visits are being sent nowhere. Fix it in the storefront Vercel project (step 1).</>
            : idMismatch ? <>The site uses <b>{g.gaIdOnSite}</b> but this ERP expects <b>{g.expectedMeasurementId}</b>. Make both the same.</>
            : <>Found <b>{g.gaIdOnSite}</b>, in the correct format.</>
          }
        />
        <Check
          ok={g.verificationMetaFound}
          warn
          title="Search Console verification tag"
          detail={g.verificationMetaFound ? 'A verification tag is on the home page.' : 'No tag found. That is fine if you verified the domain with a DNS record. If you have not verified Search Console at all, do step 2.'}
        />
        <Check ok={g.sitemapOk} title="Sitemap is readable" detail={g.sitemapOk ? 'sitemap.xml loads. Submit it in Search Console (step 2).' : 'sitemap.xml could not be read.'} />
        <Check ok={g.gscConfigured} warn title="Search Console is connected to the ERP" detail={g.gscConfigured ? `Using ${g.gscSiteUrl}.` : 'Not connected: needs GSC_SITE_URL and the service account (step 3).'} />
        <Check ok={g.ga4Configured} warn title="Analytics reports are connected to the ERP" detail={g.ga4Configured ? 'GA4 property and service account are set.' : 'Not connected: needs GA4_PROPERTY_ID and the service account (step 3).'} />
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Steps</h3>
        <Step n={1} title="Google Analytics (measuring visits and sales)">
          <p>In Google Analytics, open Admin → Data streams and choose the website stream for https://www.digitalbluez.com (create one if missing).</p>
          <p>Copy the <b>Measurement ID</b> exactly. It is “G-” plus 10 characters.</p>
          <p>In Vercel, set <code>NEXT_PUBLIC_GA_MEASUREMENT_ID</code> in the <b>storefront</b> project and <code>WEB_GA_MEASUREMENT_ID</code> in the <b>ERP</b> project, then redeploy the storefront (this value is read at build time).</p>
          <p>Open the website, then check Analytics → Realtime shows your visit. Accept the cookie banner first.</p>
        </Step>
        <Step n={2} title="Search Console (how Google sees and ranks the site)">
          <p>Go to search.google.com/search-console and add a <b>Domain</b> property for <code>digitalbluez.com</code>.</p>
          <p>Google shows a DNS TXT record. Add it where your domain&apos;s DNS is managed (Cloudflare), then press Verify. A domain property needs no code change and covers www and non-www.</p>
          <p>Open Sitemaps and submit <code>https://www.digitalbluez.com/sitemap.xml</code>.</p>
          <p>Use URL Inspection on the home page, a product, a policy page and the contact page, and press Request indexing.</p>
        </Step>
        <Step n={3} title="Connect the reports to this ERP">
          <p>The ERP reads Google data with a service account{g.serviceAccountEmail ? <>: <b className="break-all">{g.serviceAccountEmail}</b></> : ' (none configured yet)'}.</p>
          <p>Search Console → Settings → Users and permissions → add that email as a user. Analytics → Admin → Property access management → add it as Viewer.</p>
          <p>In the ERP project in Vercel set <code>GSC_SITE_URL</code> to <code>sc-domain:digitalbluez.com</code> and <code>GA4_PROPERTY_ID</code> to the numeric property ID (Analytics → Admin → Property details).</p>
          <p>Reports → Website then shows real queries, clicks and traffic, and the keyword suggestions here start using them.</p>
        </Step>
        <Step n={4} title="Google Business Profile">
          <p>Make sure the profile&apos;s website link is https://www.digitalbluez.com/ (add the UTM tag shown in the Suggestions list).</p>
          <p>Keep the name, address and phone identical to the website footer. The Suggestions list gives you a weekly, monthly and quarterly routine.</p>
        </Step>
        <Step n={5} title="Google Merchant Center (free product listings)">
          <p>Create a Merchant Center account, claim the website, and add a <b>scheduled fetch</b> feed from <code>https://www.digitalbluez.com/feeds/google.xml</code> (refreshed hourly).</p>
          <p>Set your shipping and replacement policy in the account settings. The feed lists in-stock laptops, desktops, monitors and tablets only.</p>
        </Step>
        <Step n={6} title="Optional extras">
          <p>Bing Webmaster Tools can import your Search Console site in one click. A free PageSpeed Insights API key (Google Cloud Console) lets speed checks be automated later.</p>
        </Step>
      </div>
    </div>
  )
}
