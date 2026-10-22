'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { ExternalLink } from 'lucide-react'
import { apiFetch } from '@/lib/api-client'
import { ListItem, Panes, Pill } from '@/components/MasterDetail'
import { StatusBadge } from '@/components/StatusBadge'
import { ErrorBanner } from '@/components/ErrorBanner'
import { Button } from '@/components/ui/button'
import { OPS_HEALTH_SEVERITY_TONES, OPS_HEALTH_STATUS_TONES, toneFor } from '@/lib/status-styles'

// System Health -> Daily reports. A cloud routine posts one report a day at
// ~18:00 IST (see docs/bible/modules/system-health.md); this is where the owner
// reads it and approves or rejects each finding. Approved code findings are
// turned into a GitHub PR by a second routine at 10:00 / 15:00 IST -- merging
// the PR is what deploys, so nothing here changes production directly.

interface ReportRow { id: string; report_date: string; overall: 'healthy' | 'watch' | 'act'; summary: string; created_at: string }
interface Finding {
  id: string; ref: string; severity: 'act' | 'watch' | 'info'; area: string; title: string
  evidence: string | null; suggestion: string | null; fix_kind: string; status: string
  first_seen_on: string; last_seen_on: string; decided_at: string | null; pr_url: string | null; agent_note: string | null
}

const OVERALL_PILL: Record<ReportRow['overall'], { tone: 'green' | 'amber' | 'red'; label: string }> = {
  healthy: { tone: 'green', label: 'Healthy' },
  watch: { tone: 'amber', label: 'Watch' },
  act: { tone: 'red', label: 'Act' },
}

const STATUS_LABEL: Record<string, string> = {
  proposed: 'Awaiting you',
  approved: 'Approved — fix queued',
  in_progress: 'Fix in progress',
  pr_open: 'PR open',
  needs_manual: 'Needs you',
  done: 'Done',
  rejected: 'Rejected',
  failed: 'Fix failed',
}

const FIX_KIND_LABEL: Record<string, string> = {
  code: 'Code fix (PR)',
  config: 'Config fix (PR)',
  db: 'Database fix — applied from a local session',
  infra: 'Server fix — applied from a local session',
}

function fmtDate(d: string) {
  return new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })
}

export default function OpsHealthReports() {
  const searchParams = useSearchParams()
  const [reports, setReports] = useState<ReportRow[] | null>(null)
  const [awaiting, setAwaiting] = useState(0)
  const [selected, setSelected] = useState<string | null>(searchParams.get('report'))
  const [open, setOpen] = useState(!!searchParams.get('report'))
  const [detail, setDetail] = useState<{ report: ReportRow; findings: Finding[] } | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const loadList = useCallback(async () => {
    const res = await apiFetch('/api/ops/health/findings')
    const json = await res.json().catch(() => null)
    if (!res.ok) { setError(json?.error || 'Could not load daily reports.'); return }
    setReports(json.reports)
    setAwaiting(json.awaitingDecision)
    setSelected(cur => cur ?? json.reports[0]?.id ?? null)
  }, [])

  const loadDetail = useCallback(async (id: string) => {
    const res = await apiFetch(`/api/ops/health/findings?report=${id}`)
    const json = await res.json().catch(() => null)
    if (!res.ok) { setError(json?.error || 'Could not load that report.'); return }
    setDetail(json)
  }, [])

  useEffect(() => { loadList() }, [loadList])
  useEffect(() => { if (selected) loadDetail(selected) }, [selected, loadDetail])

  async function decide(f: Finding, status: 'approved' | 'rejected') {
    setBusy(f.id)
    setError('')
    try {
      const res = await apiFetch(`/api/ops/health/findings/${f.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) { setError(json?.error || 'Could not save your decision.'); return }
      if (selected) await loadDetail(selected)
      await loadList()
    } finally {
      setBusy(null)
    }
  }

  if (reports === null && !error) return <p className="text-sm text-muted-foreground">Loading daily reports…</p>

  return (
    <div className="space-y-3">
      {error && <ErrorBanner message={error} onRetry={() => { setError(''); loadList() }} />}
      {reports && reports.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No reports yet. The first one arrives at about 6pm IST once the “Daily health report” routine is running.
        </p>
      ) : (
        <Panes
          open={open}
          onBack={() => setOpen(false)}
          backLabel="All reports"
          list={
            <div className="space-y-1">
              {awaiting > 0 && (
                <p className="mb-2 text-xs text-muted-foreground">{awaiting} finding{awaiting === 1 ? '' : 's'} awaiting your decision</p>
              )}
              {(reports ?? []).map(r => (
                <ListItem
                  key={r.id}
                  selected={selected === r.id}
                  onClick={() => { setSelected(r.id); setOpen(true) }}
                  title={fmtDate(r.report_date)}
                  sub={r.summary.length > 80 ? `${r.summary.slice(0, 80)}…` : r.summary}
                  right={<Pill tone={OVERALL_PILL[r.overall].tone}>{OVERALL_PILL[r.overall].label}</Pill>}
                />
              ))}
            </div>
          }
        >
          {!detail ? (
            <p className="text-sm text-muted-foreground">Select a report.</p>
          ) : (
            <div className="space-y-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold">{fmtDate(detail.report.report_date)}</h3>
                  <Pill tone={OVERALL_PILL[detail.report.overall].tone}>{OVERALL_PILL[detail.report.overall].label}</Pill>
                </div>
                <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">{detail.report.summary}</p>
              </div>

              {detail.findings.length === 0 && (
                <p className="text-sm text-muted-foreground">Nothing needed attention on this day.</p>
              )}

              {detail.findings.map(f => (
                <div key={f.id} className="rounded-md border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone={toneFor(OPS_HEALTH_SEVERITY_TONES, f.severity)}>{f.severity}</StatusBadge>
                    <StatusBadge tone={toneFor(OPS_HEALTH_STATUS_TONES, f.status)}>{STATUS_LABEL[f.status] ?? f.status}</StatusBadge>
                    <span className="text-xs text-muted-foreground">
                      {f.area} · {FIX_KIND_LABEL[f.fix_kind] ?? f.fix_kind}
                      {f.first_seen_on !== f.last_seen_on && ` · seen since ${fmtDate(f.first_seen_on)}`}
                    </span>
                  </div>
                  <div className="mt-2 text-sm font-medium">{f.title}</div>
                  {f.evidence && (
                    <p className="mt-1 whitespace-pre-line break-words text-sm text-muted-foreground">
                      <span className="font-medium text-foreground">Evidence: </span>{f.evidence}
                    </p>
                  )}
                  {f.suggestion && (
                    <p className="mt-1 whitespace-pre-line break-words text-sm text-muted-foreground">
                      <span className="font-medium text-foreground">Suggestion: </span>{f.suggestion}
                    </p>
                  )}
                  {f.agent_note && (
                    <p className="mt-1 whitespace-pre-line break-words text-xs text-muted-foreground">
                      <span className="font-medium">Agent note: </span>{f.agent_note}
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {['proposed', 'rejected', 'failed', 'needs_manual'].includes(f.status) && (
                      <Button size="sm" onClick={() => decide(f, 'approved')} disabled={busy === f.id}>
                        {f.status === 'proposed' ? 'Approve fix' : 'Approve again'}
                      </Button>
                    )}
                    {['proposed', 'approved'].includes(f.status) && (
                      <Button size="sm" variant="outline" onClick={() => decide(f, 'rejected')} disabled={busy === f.id}>
                        Reject
                      </Button>
                    )}
                    {f.pr_url && (
                      <a href={f.pr_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-primary underline-offset-2 hover:underline">
                        View pull request <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </div>
                </div>
              ))}

              <p className="text-xs text-muted-foreground">
                Approved code fixes are picked up at 10am and 3pm IST and prepared as a GitHub pull request — merging it is what
                deploys. Database and server fixes come back as “Needs you”, because the cloud agent cannot reach the server.
              </p>
            </div>
          )}
        </Panes>
      )}
    </div>
  )
}
