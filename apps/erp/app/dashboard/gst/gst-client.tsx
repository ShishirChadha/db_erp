'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
      const [rRes, eRes, sRes, hRes, dRes] = await Promise.all([
        apiFetch(`/api/gst/returns?metric=readiness&${qs}`),
        apiFetch(`/api/gst/returns?metric=exceptions&${qs}`),
        apiFetch(`/api/gst/returns?metric=r1_sections&${qs}`),
        apiFetch(`/api/gst/returns?metric=r1_hsn&${qs}`),
        apiFetch(`/api/gst/returns?metric=r1_docs&${qs}`),
      ])
      if (!rRes.ok) throw new Error((await rRes.json())?.error || 'Failed to load readiness')
      if (!eRes.ok) throw new Error((await eRes.json())?.error || 'Failed to load exceptions')
      setReadiness(await rRes.json())
      const ex = await eRes.json()
      setExceptions(Array.isArray(ex) ? ex : (ex?.data ?? []))
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

            <TabsContent value="papers">
              <WorkingPapers
                papers={papers}
                gstin={readiness?.entity?.gstin ?? null}
                from={period.from}
                blockers={blockers}
              />
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  )
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
              <td className="px-3 py-2">{r.record_label || '—'}</td>
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
  hsn_b2b: 'hsn', hsn_b2c: 'hsn', docs: 'docs',
}

function WorkingPapers({
  papers, gstin, from, blockers,
}: {
  papers: { sections: any; hsn: any; docs: any } | null
  gstin: string | null
  from: string
  blockers: number
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
          <Button onClick={downloadAll}>Download all sections</Button>
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
