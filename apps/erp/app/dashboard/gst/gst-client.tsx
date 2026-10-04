'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { apiFetch } from '@/lib/api-client'
import { formatCurrency } from '@db/shared'
import { ErrorBanner } from '@/components/ErrorBanner'
import { EmptyTableRow } from '@/components/EmptyTableRow'
import {
  GST_SECTIONS, sectionCsv, gstCsvFilename, downloadCsv, type GstSectionKey,
  GST_WORKSHEETS, worksheetCsv, worksheetFilename, type GstWorksheetKey,
  buildGstr1Json, gstr1JsonFilename, downloadJson,
} from '@/lib/gst-returns'

interface EntityOption {
  key: string
  legal_name: string
  gstin: string | null
  state_code: string | null
}

interface ExceptionRow {
  entity_key: string
  period_month: string | null
  check_code: string
  severity: 'blocker' | 'warning'
  check_group: 'transactions' | 'hsn_summary' | 'document_summary'
  record_type: string
  record_id: string | null
  record_label: string | null
  detail: string
}

// BUSY groups its pre-export checks exactly this way, and the grouping maps
// onto how the portal rejects an upload, so it is worth keeping.
const GROUPS: { key: ExceptionRow['check_group']; label: string }[] = [
  { key: 'transactions', label: 'Transactions' },
  { key: 'hsn_summary', label: 'HSN Summary' },
  { key: 'document_summary', label: 'Document Summary' },
]

function monthOptions(count = 18) {
  const out: { value: string; label: string; from: string; to: string }[] = []
  const now = new Date()
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const y = d.getFullYear()
    const m = d.getMonth()
    const pad = (n: number) => String(n).padStart(2, '0')
    const from = `${y}-${pad(m + 1)}-01`
    const to = `${y}-${pad(m + 1)}-${pad(new Date(y, m + 1, 0).getDate())}`
    out.push({
      value: from,
      label: d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }),
      from,
      to,
    })
  }
  return out
}

export default function GstClient() {
  const months = useMemo(() => monthOptions(), [])
  const [entities, setEntities] = useState<EntityOption[]>([])
  const [entity, setEntity] = useState<string>('')
  const [month, setMonth] = useState<string>(months[1]?.value ?? months[0].value)
  const [readiness, setReadiness] = useState<any>(null)
  const [exceptions, setExceptions] = useState<ExceptionRow[]>([])
  const [papers, setPapers] = useState<{ sections: any; hsn: any; docs: any } | null>(null)
  const [completeness2, setCompleteness2] = useState<any>(null)
  const [r3b, setR3b] = useState<any>(null)
  const [recon, setRecon] = useState<any>(null)
  const [dash, setDash] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const period = months.find((m) => m.value === month) ?? months[0]

  useEffect(() => {
    apiFetch('/api/gst/returns?metric=entities')
      .then((r) => r.json())
      .then((d) => {
        const list: EntityOption[] = Array.isArray(d) ? d : []
        setEntities(list)
        if (list.length && !entity) setEntity(list[0].key)
      })
      .catch(() => setError('Could not load GST-registered entities.'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const load = useCallback(async () => {
    if (!entity) return
    setLoading(true)
    setError('')
    try {
      const qs = `entity=${encodeURIComponent(entity)}&from=${period.from}&to=${period.to}`
      const [rRes, eRes, sRes, hRes, dRes, cRes, bRes, vRes, dashRes] = await Promise.all([
        apiFetch(`/api/gst/returns?metric=readiness&${qs}`),
        apiFetch(`/api/gst/returns?metric=exceptions&${qs}`),
        apiFetch(`/api/gst/returns?metric=r1_sections&${qs}`),
        apiFetch(`/api/gst/returns?metric=r1_hsn&${qs}`),
        apiFetch(`/api/gst/returns?metric=r1_docs&${qs}`),
        apiFetch(`/api/gst/returns?metric=completeness&${qs}`),
        apiFetch(`/api/gst/returns?metric=r3b&${qs}`),
        apiFetch(`/api/gst/returns?metric=books_vs_return&${qs}`),
        apiFetch(`/api/gst/returns?metric=dashboard&entity=${encodeURIComponent(entity)}&months=12`),
      ]) as any
      if (!rRes.ok) throw new Error((await rRes.json())?.error || 'Failed to load readiness')
      if (!eRes.ok) throw new Error((await eRes.json())?.error || 'Failed to load exceptions')
      setReadiness(await rRes.json())
      const ex = await eRes.json()
      setExceptions(Array.isArray(ex) ? ex : (ex?.data ?? []))
      setCompleteness2(cRes.ok ? await cRes.json() : null)
      setR3b(bRes.ok ? await bRes.json() : null)
      setRecon(vRes.ok ? await vRes.json() : null)
      setDash(dashRes.ok ? await dashRes.json() : null)
      setPapers({
        sections: sRes.ok ? await sRes.json() : null,
        hsn: hRes.ok ? await hRes.json() : null,
        docs: dRes.ok ? await dRes.json() : null,
      })
    } catch (e: any) {
      setError(e?.message || 'Failed to load GST data')
    } finally {
      setLoading(false)
    }
  }, [entity, period.from, period.to])

  useEffect(() => { load() }, [load])

  const blockers = readiness?.blockers ?? 0
  const warnings = readiness?.warnings ?? 0
  const canGenerate = !!readiness?.can_generate
  const completeness = readiness?.completeness
  const outward = readiness?.outward

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">GST Returns</h1>
          <p className="text-sm text-muted-foreground">
            Validate a period before filing. Figures are generated for upload to the GST portal — nothing is filed from here.
          </p>
        </div>
        <div className="flex gap-2">
          <Select value={entity} onValueChange={setEntity}>
            <SelectTrigger className="w-[220px]"><SelectValue placeholder="Entity" /></SelectTrigger>
            <SelectContent>
              {entities.map((e) => (
                <SelectItem key={e.key} value={e.key}>
                  {e.legal_name}{e.gstin ? ` · ${e.gstin}` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={month} onValueChange={setMonth}>
            <SelectTrigger className="w-[180px]"><SelectValue placeholder="Period" /></SelectTrigger>
            <SelectContent>
              {months.map((m) => (
                <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {error && <ErrorBanner message={error} />}

      {entities.length === 0 && !loading && !error && (
        <Card><CardContent className="pt-6 text-sm text-muted-foreground">
          No GST-registered entity is configured. A return only exists for an entity with
          <span className="font-medium"> GST registered</span> set in Settings → Business Profiles.
        </CardContent></Card>
      )}

      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {!loading && readiness && !readiness.error && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card className={canGenerate ? 'border-success/30' : 'border-destructive/40'}>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Filing readiness</CardTitle></CardHeader>
              <CardContent>
                <p className={`text-2xl font-semibold ${canGenerate ? 'text-success' : 'text-destructive'}`}>
                  {canGenerate ? 'Ready' : 'Blocked'}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {blockers} blocker{blockers === 1 ? '' : 's'}, {warnings} warning{warnings === 1 ? '' : 's'}
                </p>
              </CardContent>
            </Card>

            <Card className={completeness?.uninvoiced_sales > 0 ? 'border-destructive/40' : undefined}>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Sales with no invoice</CardTitle></CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold tabular-nums">{completeness?.uninvoiced_sales ?? 0}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {formatCurrency(completeness?.uninvoiced_tax ?? 0)} of tax missing from this return
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Taxable value</CardTitle></CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold tabular-nums">{formatCurrency(outward?.taxable_value ?? 0)}</p>
                <p className="text-xs text-muted-foreground mt-1">{outward?.invoices ?? 0} invoices</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Output tax</CardTitle></CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold tabular-nums">
                  {formatCurrency((outward?.cgst ?? 0) + (outward?.sgst ?? 0) + (outward?.igst ?? 0))}
                </p>
                <p className="text-xs text-muted-foreground mt-1 tabular-nums">
                  C {formatCurrency(outward?.cgst ?? 0)} · S {formatCurrency(outward?.sgst ?? 0)} · I {formatCurrency(outward?.igst ?? 0)}
                </p>
              </CardContent>
            </Card>
          </div>

          {!canGenerate && (
            <Card className="border-destructive/40">
              <CardContent className="pt-6 text-sm">
                <p className="font-medium text-destructive">This period can&apos;t be filed from the ERP yet.</p>
                <p className="text-muted-foreground mt-1">
                  Every blocker below has to be cleared first. A return generated with these outstanding would
                  under-report or be rejected at the portal.
                </p>
              </CardContent>
            </Card>
          )}

          <Tabs defaultValue="validation">
            <TabsList>
              <TabsTrigger value="validation">
                Validation{blockers + warnings > 0 ? ` (${blockers + warnings})` : ''}
              </TabsTrigger>
              <TabsTrigger value="papers">GSTR-1 working papers</TabsTrigger>
              <TabsTrigger value="reconcile">
                Reconcile{completeness2?.uninvoiced_count ? ` (${completeness2.uninvoiced_count})` : ''}
              </TabsTrigger>
              <TabsTrigger value="r3b">GSTR-3B</TabsTrigger>
              <TabsTrigger value="dashboard">All periods</TabsTrigger>
              <TabsTrigger value="uploads">Match uploads</TabsTrigger>
              <TabsTrigger value="filing">Filing &amp; locks</TabsTrigger>
            </TabsList>

            <TabsContent value="validation">
              <Tabs defaultValue="transactions">
                <TabsList>
                  {GROUPS.map((g) => {
                    const n = exceptions.filter((e) => e.check_group === g.key).length
                    return (
                      <TabsTrigger key={g.key} value={g.key}>
                        {g.label}{n > 0 ? ` (${n})` : ''}
                      </TabsTrigger>
                    )
                  })}
                </TabsList>
                {GROUPS.map((g) => (
                  <TabsContent key={g.key} value={g.key}>
                    <ExceptionTable rows={exceptions.filter((e) => e.check_group === g.key)} />
                  </TabsContent>
                ))}
              </Tabs>
            </TabsContent>

            <TabsContent value="reconcile">
              <Reconcile
                data={completeness2}
                gstin={readiness?.entity?.gstin ?? null}
                from={period.from}
              />
            </TabsContent>

            <TabsContent value="r3b">
              <Gstr3b data={r3b} recon={recon} />
            </TabsContent>

            <TabsContent value="dashboard">
              <PeriodsTable data={dash} />
            </TabsContent>

            <TabsContent value="uploads">
              <MatchUploads entity={entity} from={period.from} to={period.to} />
            </TabsContent>

            <TabsContent value="filing">
              <FilingAndLocks
                entity={entity}
                from={period.from}
                to={period.to}
                periodLabel={period.label}
                blockers={blockers}
                onChanged={load}
              />
            </TabsContent>

            <TabsContent value="papers">
              <WorkingPapers
                papers={papers}
                gstin={readiness?.entity?.gstin ?? null}
                from={period.from}
                blockers={blockers}
                recon={recon}
              />
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  )
}

/**
 * Where a finding can be opened. Only invoices have a detail route today, so
 * everything else links to its list page -- which is still better than a label
 * you have to go and search for by hand. Deliberately returns null rather than
 * a dead link where there is nothing useful to open.
 */
function recordHref(r: ExceptionRow): string | null {
  if (!r.record_id) return null
  switch (r.record_type) {
    case 'invoice': return `/dashboard/invoices/${r.record_id}`
    case 'sale': return '/dashboard/sales'
    case 'customer': return '/dashboard/customers'
    case 'sku': return '/dashboard/sku-master'
    default: return null
  }
}

function ExceptionTable({ rows }: { rows: ExceptionRow[] }) {
  // Blockers first, then by check so like problems sit together.
  const sorted = [...rows].sort((a, b) =>
    a.severity === b.severity
      ? a.check_code.localeCompare(b.check_code)
      : a.severity === 'blocker' ? -1 : 1
  )
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted">
          <tr>
            <th className="text-left px-3 py-2 font-medium text-muted-foreground">Period</th>
            <th className="text-left px-3 py-2 font-medium text-muted-foreground">Severity</th>
            <th className="text-left px-3 py-2 font-medium text-muted-foreground">Check</th>
            <th className="text-left px-3 py-2 font-medium text-muted-foreground">Record</th>
            <th className="text-left px-3 py-2 font-medium text-muted-foreground">What&apos;s wrong</th>
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 && <EmptyTableRow colSpan={5} message="Nothing to fix here." />}
          {sorted.map((r, i) => (
            <tr key={`${r.check_code}-${r.record_id ?? r.record_label}-${i}`} className="border-t align-top">
              <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                {r.period_month
                  ? new Date(r.period_month).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
                  : 'Any'}
              </td>
              <td className="px-3 py-2">
                <Badge variant={r.severity === 'blocker' ? 'destructive' : 'secondary'}>{r.severity}</Badge>
              </td>
              <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{r.check_code}</td>
              <td className="px-3 py-2">
                {(() => {
                  const href = recordHref(r)
                  const label = r.record_label || '—'
                  return href
                    ? <a href={href} className="underline underline-offset-2 hover:text-foreground">{label}</a>
                    : label
                })()}
              </td>
              <td className="px-3 py-2 text-muted-foreground">{r.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const PAPER_SOURCE: Record<GstSectionKey, 'sections' | 'hsn' | 'docs'> = {
  b2b: 'sections', b2cl: 'sections', b2cs: 'sections',
  cdnr: 'sections', cdnur: 'sections',
  hsn_b2b: 'hsn', hsn_b2c: 'hsn', docs: 'docs',
}

function WorkingPapers({
  papers, gstin, from, blockers, recon,
}: {
  papers: { sections: any; hsn: any; docs: any } | null
  gstin: string | null
  from: string
  blockers: number
  recon?: any
}) {
  if (!papers) return <p className="text-sm text-muted-foreground">No working papers for this period.</p>

  const keys = Object.keys(GST_SECTIONS) as GstSectionKey[]
  const payloadFor = (k: GstSectionKey) => papers[PAPER_SOURCE[k]]
  const countFor = (k: GstSectionKey) => {
    try { return GST_SECTIONS[k].rows(payloadFor(k)).length } catch { return 0 }
  }

  const download = (k: GstSectionKey) =>
    downloadCsv(gstCsvFilename(k, gstin, from), sectionCsv(k, payloadFor(k)))

  const downloadAll = () => keys.forEach((k) => download(k))

  // Table 12 has to tie to the section totals -- the portal cross-validates it.
  const sectionTx = ['b2b', 'b2cl', 'b2cs'].reduce((sum, k) => {
    const rows = GST_SECTIONS[k as GstSectionKey].rows(papers.sections) as any[]
    return sum + rows.reduce((a, r) => a + Number(r['Taxable Value'] || 0), 0)
  }, 0)
  const hsnTx = ['hsn_b2b', 'hsn_b2c'].reduce((sum, k) => {
    const rows = GST_SECTIONS[k as GstSectionKey].rows(papers.hsn) as any[]
    return sum + rows.reduce((a, r) => a + Number(r['Taxable Value'] || 0), 0)
  }, 0)
  const tableTwelveTies = Math.abs(sectionTx - hsnTx) < 1

  return (
    <div className="space-y-4">
      {blockers > 0 && (
        <Card className="border-destructive/40">
          <CardContent className="pt-6 text-sm">
            <p className="font-medium text-destructive">
              {blockers} blocker{blockers === 1 ? '' : 's'} outstanding — these figures are not filing-ready.
            </p>
            <p className="text-muted-foreground mt-1">
              You can still download them to work through with your CA, but clear the Validation tab before filing.
            </p>
          </CardContent>
        </Card>
      )}

      <Card className={tableTwelveTies ? undefined : 'border-destructive/40'}>
        <CardContent className="pt-6 text-sm flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-medium">
              Table 12 vs Tables 4/5/7:{' '}
              <span className={tableTwelveTies ? 'text-success' : 'text-destructive'}>
                {tableTwelveTies ? 'reconciled' : 'mismatch'}
              </span>
            </p>
            <p className="text-muted-foreground mt-1 tabular-nums">
              Sections {formatCurrency(sectionTx)} · HSN summary {formatCurrency(hsnTx)}
              {!tableTwelveTies && ` · difference ${formatCurrency(Math.abs(sectionTx - hsnTx))}`}
            </p>
            {!tableTwelveTies && (
              <p className="text-muted-foreground mt-1">
                The portal validates these against each other. The gap is lines whose HSN could not be
                resolved — see <span className="font-mono text-xs">invoice_line_hsn_unresolvable</span> under Validation.
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={downloadAll}>All sections (CSV)</Button>
            <Button
              disabled={!gstin}
              onClick={() => downloadJson(
                gstr1JsonFilename(gstin!, from),
                buildGstr1Json({
                  gstin: gstin!, periodFrom: from,
                  sections: papers.sections, hsn: papers.hsn, docs: papers.docs,
                })
              )}
            >
              Portal JSON
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">Section</th>
              <th className="text-right px-3 py-2 font-medium text-muted-foreground">Rows</th>
              <th className="text-right px-3 py-2 font-medium text-muted-foreground">Taxable value</th>
              <th className="text-right px-3 py-2 font-medium text-muted-foreground">CSV</th>
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => {
              const rows = GST_SECTIONS[k].rows(payloadFor(k)) as any[]
              const tx = rows.reduce((a, r) => a + Number(r['Taxable Value'] || 0), 0)
              return (
                <tr key={k} className="border-t">
                  <td className="px-3 py-2">{GST_SECTIONS[k].label}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{countFor(k)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {k === 'docs' ? '—' : formatCurrency(tx)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button variant="outline" size="sm" onClick={() => download(k)}>Download</Button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        Column headers match the GST portal&apos;s offline-tool templates, and dates are dd-mmm-yyyy as those
        templates require. Nothing is filed from here — upload at gst.gov.in, or hand these to your CA.
      </p>
    </div>
  )
}

/**
 * The two "something is missing" problems, which are different in kind from the
 * rest of validation: a wrong value gets rejected at the portal, but a missing
 * invoice just quietly under-reports. Both have to be reconciled against
 * whatever system actually issued the invoices, so this exists to be exported
 * and worked through offline rather than fixed in the app.
 */
function Reconcile({ data, gstin, from }: { data: any; gstin: string | null; from: string }) {
  if (!data) return <p className="text-sm text-muted-foreground">Nothing to reconcile for this period.</p>

  const sales: any[] = data.uninvoiced_sales ?? []
  const gaps: any[] = data.series_gaps ?? []
  const clean = sales.length === 0 && gaps.length === 0

  const dl = (k: GstWorksheetKey) =>
    downloadCsv(worksheetFilename(k, gstin, from), worksheetCsv(k, data))

  if (clean) {
    return (
      <Card className="border-success/30">
        <CardContent className="pt-6 text-sm">
          <p className="font-medium text-success">Nothing missing.</p>
          <p className="text-muted-foreground mt-1">
            Every taxed sale in this period has an invoice, and the number series has no gaps.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <Card className="border-destructive/40">
        <CardContent className="pt-6 text-sm flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-medium text-destructive">
              {sales.length} sale{sales.length === 1 ? '' : 's'} with no invoice
              {gaps.length > 0 && `, and ${gaps.length} missing invoice number${gaps.length === 1 ? '' : 's'}`}
            </p>
            <p className="text-muted-foreground mt-1 tabular-nums">
              {formatCurrency(data.uninvoiced_taxable ?? 0)} taxable ·{' '}
              {formatCurrency(data.uninvoiced_tax ?? 0)} GST absent from this return
            </p>
            <p className="text-muted-foreground mt-1">
              Download these, fill in the invoice number against each row from Zoho, then record them
              in the ERP. A missing invoice is the one failure that under-reports silently instead of
              being rejected at the portal.
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            {sales.length > 0 && <Button onClick={() => dl('uninvoiced')}>Sales worksheet</Button>}
            {gaps.length > 0 && <Button variant="outline" onClick={() => dl('gaps')}>Gaps worksheet</Button>}
          </div>
        </CardContent>
      </Card>

      {gaps.length > 0 && (
        <div>
          <h3 className="text-sm font-medium mb-2">Missing invoice numbers</h3>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Missing</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Comes after</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Comes before</th>
                </tr>
              </thead>
              <tbody>
                {gaps.map((g) => (
                  <tr key={g.missing_number} className="border-t">
                    <td className="px-3 py-2 font-mono tabular-nums">{g.missing_number}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {g.previous_invoice} ({g.previous_date})
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {g.next_invoice} ({g.next_date})
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {sales.length > 0 && (
        <div>
          <h3 className="text-sm font-medium mb-2">Sales with no invoice</h3>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Date</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Customer</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Asset / Serial</th>
                  <th className="text-right px-3 py-2 font-medium text-muted-foreground">Taxable</th>
                  <th className="text-right px-3 py-2 font-medium text-muted-foreground">GST</th>
                  <th className="text-right px-3 py-2 font-medium text-muted-foreground">Total</th>
                </tr>
              </thead>
              <tbody>
                {sales.map((r) => (
                  <tr key={r.sale_id} className="border-t">
                    <td className="px-3 py-2 whitespace-nowrap">{r.sale_date}</td>
                    <td className="px-3 py-2">{r.customer_name || '—'}</td>
                    <td className="px-3 py-2 font-mono text-xs">{r.identifier || '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(r.taxable_value)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(r.gst)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(r.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function TaxRow({ label, v }: { label: string; v: any }) {
  return (
    <tr className="border-t">
      <td className="px-3 py-2">{label}</td>
      <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(v?.taxable_value ?? 0)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(v?.cgst ?? 0)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(v?.sgst ?? 0)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(v?.igst ?? v?.tax ?? 0)}</td>
    </tr>
  )
}

function Gstr3b({ data, recon }: { data: any; recon: any }) {
  if (!data || data.error) return <p className="text-sm text-muted-foreground">No 3B figures for this period.</p>
  if (data.not_registered) {
    return <Card><CardContent className="pt-6 text-sm text-muted-foreground">
      This entity isn&apos;t GST registered, so it has no return.
    </CardContent></Card>
  }

  const t31 = data.table_3_1 ?? {}
  const itc = data.table_4_itc ?? {}
  const sum = (o: any) => (Number(o?.cgst ?? 0) + Number(o?.sgst ?? 0) + Number(o?.igst ?? 0))

  return (
    <div className="space-y-4">
      <Card className="border-warning/30">
        <CardContent className="pt-6 text-sm">
          <p className="font-medium">These are figures to key in and check against the portal — not to file from.</p>
          <p className="text-muted-foreground mt-1">{data.caveat}</p>
        </CardContent>
      </Card>

      <div>
        <h3 className="text-sm font-medium mb-2">Table 3.1 — Outward supplies and inward reverse charge</h3>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Nature of supply</th>
                <th className="text-right px-3 py-2 font-medium text-muted-foreground">Taxable value</th>
                <th className="text-right px-3 py-2 font-medium text-muted-foreground">CGST</th>
                <th className="text-right px-3 py-2 font-medium text-muted-foreground">SGST</th>
                <th className="text-right px-3 py-2 font-medium text-muted-foreground">IGST</th>
              </tr>
            </thead>
            <tbody>
              <TaxRow label="(a) Outward taxable (other than zero-rated, nil, exempt)" v={t31.a_outward_taxable} />
              <TaxRow label="(b) Outward zero-rated" v={t31.b_zero_rated} />
              <TaxRow label="(c) Other outward — nil-rated, exempt" v={t31.c_nil_exempt} />
              <TaxRow label="(d) Inward liable to reverse charge" v={t31.d_inward_reverse_charge} />
              <TaxRow label="(e) Non-GST outward" v={t31.e_non_gst_outward} />
            </tbody>
          </table>
        </div>
        {Number(t31.d_inward_reverse_charge?.import_of_services_taxable ?? 0) === 0 && (
          <p className="text-xs text-muted-foreground mt-2">
            Nothing is recorded under reverse charge. If you pay for foreign advertising or cloud services
            (Google, Meta, AWS), that is an import of service and carries an RCM liability here —
            tag those expenses so they appear.
          </p>
        )}
      </div>

      <div>
        <h3 className="text-sm font-medium mb-2">Table 4 — Input tax credit</h3>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Row</th>
                <th className="text-right px-3 py-2 font-medium text-muted-foreground">CGST</th>
                <th className="text-right px-3 py-2 font-medium text-muted-foreground">SGST</th>
                <th className="text-right px-3 py-2 font-medium text-muted-foreground">IGST</th>
                <th className="text-right px-3 py-2 font-medium text-muted-foreground">Total</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['4(A) ITC available — all other', itc['4A_all_other_itc']],
                ['4(B) ITC reversed', itc['4B_reversed']],
                ['4(D) Ineligible', itc['4D_ineligible']],
                ['Not yet claimed (pending)', itc['pending_not_yet_claimed']],
              ].map(([label, v]: any) => (
                <tr key={label} className="border-t">
                  <td className="px-3 py-2">{label}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(v?.cgst ?? 0)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(v?.sgst ?? 0)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(v?.igst ?? 0)}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium">{formatCurrency(sum(v))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Computed from ITC tagging in this ERP. The portal fills Table 4 from GSTR-2B instead, so these will
          not agree until the purchase register has been reconciled against 2B.
        </p>
      </div>

      {(data.table_3_2_interstate_unregistered ?? []).length > 0 && (
        <div>
          <h3 className="text-sm font-medium mb-2">Table 3.2 — Inter-state supplies to unregistered persons</h3>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Place of supply</th>
                  <th className="text-right px-3 py-2 font-medium text-muted-foreground">Taxable value</th>
                  <th className="text-right px-3 py-2 font-medium text-muted-foreground">IGST</th>
                </tr>
              </thead>
              <tbody>
                {data.table_3_2_interstate_unregistered.map((r: any) => (
                  <tr key={r.pos} className="border-t">
                    <td className="px-3 py-2">{r.pos}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(r.taxable_value)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(r.igst)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {recon && <BooksVsReturn recon={recon} />}
    </div>
  )
}

function BooksVsReturn({ recon }: { recon: any }) {
  const tdiff = Number(recon.taxable_difference ?? 0)
  const t12diff = Number(recon.table_12_difference ?? 0)
  return (
    <div>
      <h3 className="text-sm font-medium mb-2">Books vs return</h3>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">Source</th>
              <th className="text-right px-3 py-2 font-medium text-muted-foreground">Taxable value</th>
              <th className="text-right px-3 py-2 font-medium text-muted-foreground">Tax</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t">
              <td className="px-3 py-2">Sales ledger ({recon.books?.sales ?? 0} taxed sales)</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(recon.books?.taxable_value)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(recon.books?.tax)}</td>
            </tr>
            <tr className="border-t">
              <td className="px-3 py-2">GSTR-1 ({recon.return?.invoices ?? 0} invoices)</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(recon.return?.taxable_value)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(recon.return?.tax)}</td>
            </tr>
            <tr className="border-t bg-muted/40">
              <td className="px-3 py-2 font-medium">Difference</td>
              <td className={`px-3 py-2 text-right tabular-nums font-medium ${Math.abs(tdiff) > 1 ? 'text-destructive' : 'text-success'}`}>
                {formatCurrency(tdiff)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums font-medium">
                {formatCurrency(recon.tax_difference)}
              </td>
            </tr>
            <tr className="border-t">
              <td className="px-3 py-2">Table 12 (HSN summary)</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(recon.table_12_taxable_value)}</td>
              <td className={`px-3 py-2 text-right tabular-nums ${Math.abs(t12diff) > 1 ? 'text-destructive' : 'text-success'}`}>
                {Math.abs(t12diff) > 1 ? `off by ${formatCurrency(t12diff)}` : 'ties'}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground mt-2">{recon.note}</p>
    </div>
  )
}

function PeriodsTable({ data }: { data: any }) {
  const rows: any[] = data?.rows ?? []
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No periods.</p>
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">Period</th>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">Return</th>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">Status</th>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">Due</th>
              <th className="text-right px-3 py-2 font-medium text-muted-foreground">Blockers</th>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">ARN</th>
              <th className="text-right px-3 py-2 font-medium text-muted-foreground">Barred in</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const overdue = Number(r.days_overdue ?? 0) > 0 && r.status !== 'filed'
              const barSoon = Number(r.days_until_barred ?? 9999) < 180
              return (
                <tr key={`${r.period_start}-${r.return_type}`} className="border-t">
                  <td className="px-3 py-2 whitespace-nowrap">
                    {new Date(r.period_start).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}
                  </td>
                  <td className="px-3 py-2 uppercase text-xs font-mono">{r.return_type}</td>
                  <td className="px-3 py-2">
                    <Badge variant={r.status === 'filed' ? 'secondary' : overdue ? 'destructive' : 'outline'}>
                      {r.status.replace('_', ' ')}
                    </Badge>
                  </td>
                  <td className={`px-3 py-2 whitespace-nowrap ${overdue ? 'text-destructive' : 'text-muted-foreground'}`}>
                    {r.due_date}{overdue ? ` (${r.days_overdue}d late)` : ''}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {Number(r.blockers) > 0
                      ? <span className="text-destructive">{r.blockers}</span>
                      : <span className="text-success">0</span>}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{r.arn || '—'}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${barSoon ? 'text-destructive' : 'text-muted-foreground'}`}>
                    {Number(r.days_until_barred) > 0 ? `${r.days_until_barred}d` : 'barred'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        A return cannot be filed more than three years past its due date — enforced on the portal since
        1 October 2025, with no late fee or appeal that reopens it, and the liability survives.
      </p>
    </div>
  )
}

const UPLOAD_KINDS = [
  {
    kind: 'zoho_invoices' as const,
    label: 'Zoho invoice register',
    accept: '.csv,text/csv',
    blurb: 'Export your invoice list from Zoho as CSV. Checks that nothing you invoiced is missing from what the ERP would report in GSTR-1 — the failure that under-reports silently instead of being rejected.',
  },
  {
    kind: 'gstr2b' as const,
    label: 'GSTR-2B (portal JSON)',
    accept: '.json,application/json',
    blurb: 'Download GSTR-2B for the period from the GST portal in JSON form. Checks your purchase register against what suppliers actually filed — both credit you are owed and are not taking, and credit 2B does not support.',
  },
]

const BUCKETS: { key: string; label: string; tone: 'ok' | 'warn' | 'bad' }[] = [
  { key: 'missing_in_erp', label: 'In the upload, not in the ERP', tone: 'bad' },
  { key: 'missing_in_source', label: 'In the ERP, not in the upload', tone: 'bad' },
  { key: 'value_mismatch', label: 'Found, figures differ', tone: 'warn' },
  { key: 'matched', label: 'Matched', tone: 'ok' },
]

function MatchUploads({ entity, from, to }: { entity: string; from: string; to: string }) {
  const [imports, setImports] = useState<any[]>([])
  const [active, setActive] = useState<any>(null)
  const [lines, setLines] = useState<any[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  const loadImports = useCallback(async () => {
    const r = await apiFetch(`/api/gst/recon?entity=${encodeURIComponent(entity)}`)
    if (r.ok) setImports(await r.json())
  }, [entity])

  useEffect(() => { loadImports() }, [loadImports])

  const openImport = async (id: string) => {
    setErr(''); setMsg('')
    const r = await apiFetch(`/api/gst/recon?import_id=${id}`)
    if (!r.ok) { setErr('Could not load that reconciliation.'); return }
    const d = await r.json()
    setActive(d.import); setLines(d.lines ?? [])
  }

  const upload = async (kind: string, file: File) => {
    setBusy(true); setErr(''); setMsg('')
    try {
      const content = await file.text()
      const r = await apiFetch('/api/gst/recon', {
        method: 'POST',
        body: JSON.stringify({
          entity_key: entity, kind, period_start: from, period_end: to,
          content, source_filename: file.name,
        }),
      })
      const d = await r.json()
      if (!r.ok) {
        setErr(d?.error || 'Upload failed')
        return
      }
      setMsg(`Read ${d.rows} rows from ${file.name}.`)
      await loadImports()
      await openImport(d.import.id)
    } catch (e: any) {
      setErr(e?.message || 'Upload failed')
    } finally {
      setBusy(false)
    }
  }

  const resolve = async (lineId: string, resolution: string) => {
    const r = await apiFetch('/api/gst/recon', {
      method: 'PATCH',
      body: JSON.stringify({ id: lineId, resolution }),
    })
    if (r.ok && active) openImport(active.id)
  }

  return (
    <div className="space-y-4">
      {err && <ErrorBanner message={err} />}
      {msg && <p className="text-sm text-success">{msg}</p>}

      <div className="grid gap-4 md:grid-cols-2">
        {UPLOAD_KINDS.map((k) => (
          <Card key={k.kind}>
            <CardHeader className="pb-2"><CardTitle className="text-base">{k.label}</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">{k.blurb}</p>
              <input
                type="file"
                accept={k.accept}
                disabled={busy}
                className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-input file:bg-background file:px-3 file:py-1.5 file:text-sm"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) upload(k.kind, f)
                  e.target.value = ''
                }}
              />
            </CardContent>
          </Card>
        ))}
      </div>

      {imports.length > 0 && (
        <div>
          <h3 className="text-sm font-medium mb-2">Previous uploads</h3>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Period</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Source</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">File</th>
                  <th className="text-right px-3 py-2 font-medium text-muted-foreground">Rows</th>
                  <th className="text-right px-3 py-2 font-medium text-muted-foreground">Matched</th>
                  <th className="text-right px-3 py-2 font-medium text-muted-foreground">Problems</th>
                  <th className="text-right px-3 py-2 font-medium text-muted-foreground"></th>
                </tr>
              </thead>
              <tbody>
                {imports.map((i) => {
                  const problems = i.mismatch_count + i.missing_in_erp_count + i.missing_in_source_count
                  return (
                    <tr key={i.id} className="border-t">
                      <td className="px-3 py-2 whitespace-nowrap">{i.period_start}</td>
                      <td className="px-3 py-2">{i.kind === 'gstr2b' ? 'GSTR-2B' : 'Zoho'}</td>
                      <td className="px-3 py-2 text-muted-foreground text-xs">{i.source_filename || '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{i.row_count}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-success">{i.matched_count}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {problems > 0 ? <span className="text-destructive">{problems}</span> : <span className="text-success">0</span>}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button variant="outline" size="sm" onClick={() => openImport(i.id)}>Open</Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {active && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium">
            {active.kind === 'gstr2b' ? 'GSTR-2B' : 'Zoho'} · {active.period_start}
            {active.notes && <span className="ml-2 text-xs text-warning">{active.notes}</span>}
          </h3>
          {BUCKETS.map((b) => {
            const rows = lines.filter((l) => l.match_status === b.key)
            if (rows.length === 0) return null
            return (
              <div key={b.key}>
                <p className={`text-xs font-medium mb-1 ${b.tone === 'bad' ? 'text-destructive' : b.tone === 'warn' ? 'text-warning' : 'text-success'}`}>
                  {b.label} — {rows.length}
                </p>
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Date</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Document</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Counterparty</th>
                        <th className="text-right px-3 py-2 font-medium text-muted-foreground">Taxable</th>
                        <th className="text-right px-3 py-2 font-medium text-muted-foreground">Tax</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Difference</th>
                        <th className="text-right px-3 py-2 font-medium text-muted-foreground">Decision</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.slice(0, 60).map((l) => (
                        <tr key={l.id} className="border-t align-top">
                          <td className="px-3 py-2 whitespace-nowrap">{l.doc_date || '—'}</td>
                          <td className="px-3 py-2 font-mono text-xs">{l.doc_number || '—'}</td>
                          <td className="px-3 py-2">
                            {l.counterparty_name || '—'}
                            {l.counterparty_gstin && <span className="block text-xs text-muted-foreground font-mono">{l.counterparty_gstin}</span>}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(l.taxable_value)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {formatCurrency((Number(l.cgst) || 0) + (Number(l.sgst) || 0) + (Number(l.igst) || 0))}
                          </td>
                          <td className="px-3 py-2 text-xs text-muted-foreground max-w-[22rem]">
                            {l.diff ? Object.entries(l.diff).map(([k, v]: any) => (
                              <span key={k} className="block">
                                {k}: {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                              </span>
                            )) : '—'}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {l.resolution
                              ? <Badge variant="secondary">{l.resolution.replace(/_/g, ' ')}</Badge>
                              : (
                                <div className="flex gap-1 justify-end">
                                  {active.kind === 'gstr2b' && l.match_status === 'missing_in_source' && (
                                    <Button size="sm" variant="outline" onClick={() => resolve(l.id, 'chase_supplier')}>Chase</Button>
                                  )}
                                  {active.kind === 'gstr2b' && l.match_status === 'matched' && (
                                    <Button size="sm" variant="outline" onClick={() => resolve(l.id, 'itc_claimed')}>Claim ITC</Button>
                                  )}
                                  <Button size="sm" variant="ghost" onClick={() => resolve(l.id, 'ignored')}>Ignore</Button>
                                </div>
                              )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {rows.length > 60 && (
                  <p className="text-xs text-muted-foreground mt-1">Showing 60 of {rows.length}.</p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

const LOCK_MODULES = [
  { key: 'sales', label: 'Sales — invoices, sales, payments' },
  { key: 'purchases', label: 'Purchases — POs, bills, vendor payments' },
  { key: 'banking', label: 'Banking — transactions, transfers' },
  { key: 'accounts', label: 'Accounts — journals, tax entries' },
]

function FilingAndLocks({
  entity, from, to, periodLabel, blockers, onChanged,
}: {
  entity: string; from: string; to: string; periodLabel: string
  blockers: number; onChanged: () => void
}) {
  const [filings, setFilings] = useState<any[]>([])
  const [locks, setLocks] = useState<any[]>([])
  const [arn, setArn] = useState('')
  const [returnType, setReturnType] = useState('gstr1')
  const [lockModule, setLockModule] = useState('sales')
  const [lockThrough, setLockThrough] = useState(to)
  const [lockReason, setLockReason] = useState('')
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    const [f, l] = await Promise.all([
      apiFetch(`/api/gst/filings?entity=${encodeURIComponent(entity)}`),
      apiFetch('/api/gst/period-locks'),
    ])
    if (f.ok) setFilings(await f.json())
    if (l.ok) setLocks(await l.json())
  }, [entity])

  useEffect(() => { refresh() }, [refresh])

  const record = async (status: string, force = false) => {
    setBusy(true); setErr(''); setMsg('')
    try {
      const r = await apiFetch('/api/gst/filings', {
        method: 'POST',
        body: JSON.stringify({
          entity_key: entity, return_type: returnType,
          period_start: from, period_end: to,
          status, arn: arn || null, force,
        }),
      })
      const d = await r.json()
      if (!r.ok) { setErr(d?.error || 'Failed'); return }
      setMsg(status === 'filed'
        ? `Recorded ${returnType.toUpperCase()} for ${periodLabel} as filed.`
        : `Snapshot captured for ${periodLabel}.`)
      setArn('')
      await refresh(); onChanged()
    } finally { setBusy(false) }
  }

  const setLock = async () => {
    setBusy(true); setErr(''); setMsg('')
    try {
      const r = await apiFetch('/api/gst/period-locks', {
        method: 'POST',
        body: JSON.stringify({
          entity_key: entity, module: lockModule,
          locked_through_date: lockThrough, reason: lockReason || null,
        }),
      })
      const d = await r.json()
      if (!r.ok) { setErr(d?.error || 'Failed'); return }
      setMsg(`${lockModule} locked through ${lockThrough}.`)
      setLockReason(''); await refresh()
    } finally { setBusy(false) }
  }

  const unlock = async (id: string) => {
    const reason = window.prompt('Why are you reopening this period? This is recorded.')
    if (!reason?.trim()) return
    const l = locks.find((x) => x.id === id)
    const r = await apiFetch('/api/gst/period-locks', {
      method: 'PATCH',
      body: JSON.stringify({
        id, unlock_from: from, unlock_to: to, unlock_reason: reason.trim(),
      }),
    })
    if (r.ok) { setMsg(`Reopened ${l?.module} for ${periodLabel}.`); refresh() }
    else setErr((await r.json())?.error || 'Failed')
  }

  const relock = async (id: string) => {
    const r = await apiFetch('/api/gst/period-locks', { method: 'PATCH', body: JSON.stringify({ id }) })
    if (r.ok) { setMsg('Window closed again.'); refresh() }
  }

  return (
    <div className="space-y-5">
      {err && <ErrorBanner message={err} />}
      {msg && <p className="text-sm text-success">{msg}</p>}

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Record a filing — {periodLabel}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            This records what you filed; it does not file anything at the portal. The point is the frozen
            snapshot of the figures — without it, an edit made after filing is undetectable.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Return</label>
              <Select value={returnType} onValueChange={setReturnType}>
                <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="gstr1">GSTR-1</SelectItem>
                  <SelectItem value="gstr3b">GSTR-3B</SelectItem>
                  <SelectItem value="gstr1a">GSTR-1A</SelectItem>
                  <SelectItem value="gstr9">GSTR-9</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">ARN (from the portal)</label>
              <Input value={arn} onChange={(e) => setArn(e.target.value)} placeholder="optional" className="w-[220px]" />
            </div>
            <Button variant="outline" disabled={busy} onClick={() => record('exported')}>Snapshot as exported</Button>
            <Button disabled={busy} onClick={() => record('filed')}>Mark filed</Button>
          </div>
          {blockers > 0 && (
            <p className="text-xs text-destructive">
              {blockers} blocker{blockers === 1 ? '' : 's'} outstanding — marking this period filed will be
              refused. Clear the Validation tab first.
            </p>
          )}
        </CardContent>
      </Card>

      {filings.length > 0 && (
        <div>
          <h3 className="text-sm font-medium mb-2">Recorded filings</h3>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Period</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Return</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Status</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">ARN</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Filed</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Snapshot</th>
                </tr>
              </thead>
              <tbody>
                {filings.map((f) => (
                  <tr key={f.id} className="border-t">
                    <td className="px-3 py-2 whitespace-nowrap">{f.period_start}</td>
                    <td className="px-3 py-2 uppercase text-xs font-mono">{f.return_type}</td>
                    <td className="px-3 py-2"><Badge variant={f.status === 'filed' ? 'secondary' : 'outline'}>{f.status}</Badge></td>
                    <td className="px-3 py-2 font-mono text-xs">{f.arn || '—'}</td>
                    <td className="px-3 py-2 text-muted-foreground text-xs">
                      {f.filed_at ? new Date(f.filed_at).toLocaleDateString('en-IN') : '—'}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{f.snapshot ? 'captured' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Period locks</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Blocks writes by <span className="font-medium">transaction date</span>, not entry date — that is what
            stops a back-dated row landing in a period you have already filed. Drafts stay editable. Currently
            enforced on new sales, voids and invoice finalise.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Module</label>
              <Select value={lockModule} onValueChange={setLockModule}>
                <SelectTrigger className="w-[260px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LOCK_MODULES.map((m) => <SelectItem key={m.key} value={m.key}>{m.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Lock through</label>
              <Input type="date" value={lockThrough} onChange={(e) => setLockThrough(e.target.value)} className="w-[160px]" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Reason</label>
              <Input value={lockReason} onChange={(e) => setLockReason(e.target.value)} placeholder="e.g. GSTR-1 filed" className="w-[220px]" />
            </div>
            <Button disabled={busy} onClick={setLock}>Lock</Button>
          </div>

          {locks.length > 0 && (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Module</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Locked through</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Reason</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Open window</th>
                    <th className="text-right px-3 py-2 font-medium text-muted-foreground"></th>
                  </tr>
                </thead>
                <tbody>
                  {locks.map((l) => (
                    <tr key={l.id} className="border-t">
                      <td className="px-3 py-2">{l.module}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{l.locked_through_date}</td>
                      <td className="px-3 py-2 text-muted-foreground text-xs">{l.reason || '—'}</td>
                      <td className="px-3 py-2 text-xs">
                        {l.unlock_from
                          ? <span className="text-warning">{l.unlock_from} → {l.unlock_to}: {l.unlock_reason}</span>
                          : <span className="text-muted-foreground">none</span>}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {l.unlock_from
                          ? <Button size="sm" variant="ghost" onClick={() => relock(l.id)}>Close window</Button>
                          : <Button size="sm" variant="outline" onClick={() => unlock(l.id)}>Reopen {periodLabel}</Button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
