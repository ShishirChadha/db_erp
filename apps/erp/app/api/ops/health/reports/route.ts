import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { hasOpsToken } from '@/lib/ops-auth'
import { sendEmail } from '@/lib/email'
import { renderOpsHealthEmail, type OpsEmailFinding } from '@/lib/ops-health-email'

// Machine side of the daily health report (token auth, see lib/ops-auth.ts):
//   GET  ?latest=1          -> most recent report + its findings, for trend comparison
//   GET  ?status=approved   -> findings the owner approved, for the fix routine
//   POST                    -> store today's report, email it, notify the owner
// The owner's own view lives at /api/ops/health/findings (session auth).
export const dynamic = 'force-dynamic'

const OPEN_STATUSES = ['proposed', 'approved', 'in_progress', 'pr_open'] as const
const SEVERITIES = ['act', 'watch', 'info'] as const
const AREAS = ['storefront', 'erp', 'database', 'server', 'infra'] as const
const FIX_KINDS = ['code', 'db', 'infra', 'config'] as const
const OVERALLS = ['healthy', 'watch', 'act'] as const

const FINDING_COLUMNS = 'id, report_id, ref, severity, area, title, evidence, suggestion, fix_kind, status, first_seen_on, last_seen_on, decided_at, pr_url, agent_note'

export async function GET(req: NextRequest) {
  if (!hasOpsToken(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sp = new URL(req.url).searchParams

  if (sp.get('status') === 'approved') {
    const { data, error } = await supabaseAdmin
      .from('ops_health_findings')
      .select(FINDING_COLUMNS)
      .eq('status', 'approved')
      .order('decided_at', { ascending: true })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ findings: data ?? [] })
  }

  if (sp.get('latest') === '1') {
    const { data: report, error } = await supabaseAdmin
      .from('ops_health_reports')
      .select('id, report_date, overall, summary, metrics, created_at')
      .order('report_date', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    // Every finding still open, plus anything closed recently, so the agent
    // knows what the owner already rejected and does not keep re-raising it.
    const since = new Date(Date.now() - 14 * 86400_000).toISOString().slice(0, 10)
    const { data: findings } = await supabaseAdmin
      .from('ops_health_findings')
      .select(FINDING_COLUMNS)
      .or(`status.in.(${OPEN_STATUSES.join(',')}),last_seen_on.gte.${since}`)
      .order('last_seen_on', { ascending: false })
    return NextResponse.json({ report: report ?? null, findings: findings ?? [] })
  }

  return NextResponse.json({ error: 'Pass ?latest=1 or ?status=approved' }, { status: 400 })
}

interface IncomingFinding {
  ref: string
  severity: typeof SEVERITIES[number]
  area: typeof AREAS[number]
  title: string
  evidence: string | null
  suggestion: string | null
  fix_kind: typeof FIX_KINDS[number]
}

function str(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t.slice(0, max) : null
}

function parseFindings(raw: unknown): { ok: true; findings: IncomingFinding[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: 'findings must be an array' }
  if (raw.length > 20) return { ok: false, error: 'at most 20 findings per report' }
  const out: IncomingFinding[] = []
  const seen = new Set<string>()
  for (const [i, f] of raw.entries()) {
    const ref = str(f?.ref, 80)
    if (!ref || !/^[a-z0-9][a-z0-9-]{2,79}$/.test(ref)) return { ok: false, error: `findings[${i}].ref must be a lowercase-hyphen slug` }
    if (seen.has(ref)) return { ok: false, error: `duplicate ref ${ref}` }
    seen.add(ref)
    if (!SEVERITIES.includes(f?.severity)) return { ok: false, error: `findings[${i}].severity must be one of ${SEVERITIES.join('/')}` }
    if (!AREAS.includes(f?.area)) return { ok: false, error: `findings[${i}].area must be one of ${AREAS.join('/')}` }
    if (!FIX_KINDS.includes(f?.fix_kind)) return { ok: false, error: `findings[${i}].fix_kind must be one of ${FIX_KINDS.join('/')}` }
    const title = str(f?.title, 200)
    if (!title) return { ok: false, error: `findings[${i}].title is required` }
    out.push({
      ref, title,
      severity: f.severity, area: f.area, fix_kind: f.fix_kind,
      evidence: str(f?.evidence, 4000),
      suggestion: str(f?.suggestion, 4000),
    })
  }
  return { ok: true, findings: out }
}

async function ownerRecipients(): Promise<{ ids: string[]; emails: string[] }> {
  const { data: owners } = await supabaseAdmin
    .from('profiles')
    .select('id, contact_email')
    .eq('role', 'owner')
    .eq('is_active', true)
  const ids = (owners ?? []).map(o => o.id)
  if (process.env.ALERT_EMAIL) return { ids, emails: process.env.ALERT_EMAIL.split(',').map(s => s.trim()).filter(Boolean) }
  const emails: string[] = []
  for (const o of owners ?? []) {
    if (o.contact_email) { emails.push(o.contact_email); continue }
    const { data } = await supabaseAdmin.auth.admin.getUserById(o.id)
    if (data.user?.email) emails.push(data.user.email)
  }
  return { ids, emails }
}

export async function POST(req: NextRequest) {
  if (!hasOpsToken(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const reportDate = str(body?.report_date, 10)
  if (!reportDate || !/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) {
    return NextResponse.json({ error: 'report_date must be YYYY-MM-DD (IST date)' }, { status: 400 })
  }
  if (!OVERALLS.includes(body?.overall)) {
    return NextResponse.json({ error: `overall must be one of ${OVERALLS.join('/')}` }, { status: 400 })
  }
  const summary = str(body?.summary, 4000)
  if (!summary) return NextResponse.json({ error: 'summary is required' }, { status: 400 })
  const metrics = body?.metrics && typeof body.metrics === 'object' && !Array.isArray(body.metrics) ? body.metrics : {}
  if (JSON.stringify(metrics).length > 500_000) {
    return NextResponse.json({ error: 'metrics is too large (500KB max)' }, { status: 400 })
  }
  const parsed = parseFindings(body?.findings ?? [])
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  // One report per IST day: a retried run replaces today's instead of adding another.
  const { data: report, error: reportErr } = await supabaseAdmin
    .from('ops_health_reports')
    .upsert(
      { report_date: reportDate, overall: body.overall, summary, metrics, updated_at: new Date().toISOString() },
      { onConflict: 'report_date' }
    )
    .select('id, report_date')
    .single()
  if (reportErr || !report) return NextResponse.json({ error: reportErr?.message || 'Could not save report' }, { status: 500 })

  const { data: openRows } = await supabaseAdmin
    .from('ops_health_findings')
    .select('id, ref, status')
    .in('status', [...OPEN_STATUSES])
  const openByRef = new Map((openRows ?? []).map(r => [r.ref, r]))

  // A rejection holds for 30 days: the same issue showing up again updates the
  // rejected row's evidence quietly instead of asking the owner again every day.
  const rejectedSince = new Date(Date.now() - 30 * 86400_000).toISOString()
  const { data: rejectedRows } = await supabaseAdmin
    .from('ops_health_findings')
    .select('id, ref')
    .eq('status', 'rejected')
    .gte('decided_at', rejectedSince)
    .in('ref', parsed.findings.map(f => f.ref).concat('__none__'))
  const rejectedByRef = new Map((rejectedRows ?? []).map(r => [r.ref, r]))

  const emailFindings: OpsEmailFinding[] = []
  let suppressedAsRejected = 0
  const now = new Date().toISOString()
  for (const f of parsed.findings) {
    const existing = openByRef.get(f.ref)
    const fields = {
      report_id: report.id,
      severity: f.severity, area: f.area, title: f.title,
      evidence: f.evidence, suggestion: f.suggestion, fix_kind: f.fix_kind,
      last_seen_on: reportDate, updated_at: now,
    }
    const rejected = !existing ? rejectedByRef.get(f.ref) : undefined
    if (rejected) {
      await supabaseAdmin.from('ops_health_findings').update(fields).eq('id', rejected.id)
      suppressedAsRejected++
      continue
    }
    if (existing) {
      // A recurring issue moves forward on its existing row; whatever the owner
      // already decided (approved, PR open) is left exactly as it was.
      const { error } = await supabaseAdmin.from('ops_health_findings').update(fields).eq('id', existing.id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      emailFindings.push({ ...f, status: existing.status, isNew: false })
    } else {
      const { error } = await supabaseAdmin
        .from('ops_health_findings')
        .insert({ ...fields, ref: f.ref, status: 'proposed', first_seen_on: reportDate })
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      emailFindings.push({ ...f, status: 'proposed', isNew: true })
    }
  }

  // Proposals that did not show up today have resolved themselves (or were a
  // one-off) -- close them so the owner is not asked to decide on stale noise.
  // Only 'proposed': an approved finding is the owner's call, and the fix
  // routine reports back on it either way.
  const todaysRefs = new Set(parsed.findings.map(f => f.ref))
  const stale = (openRows ?? []).filter(r => r.status === 'proposed' && !todaysRefs.has(r.ref)).map(r => r.id)
  if (stale.length) {
    await supabaseAdmin
      .from('ops_health_findings')
      .update({ status: 'done', agent_note: `Resolved — not seen in the ${reportDate} report.`, updated_at: now })
      .in('id', stale)
      .lt('last_seen_on', reportDate)
  }

  const recipients = await ownerRecipients()
  const { subject, html } = renderOpsHealthEmail({
    reportId: report.id, reportDate, overall: body.overall, summary,
    findings: emailFindings.sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity)),
  })
  const emailRes = recipients.emails.length
    ? await sendEmail({ to: recipients.emails, subject, html })
    : { success: false, error: 'No owner email address found' }

  // Inserted directly rather than through notify(): notify() would also send
  // its own plain-text email, duplicating the rich one above (same reason the
  // digest route does this).
  if (recipients.ids.length) {
    await supabaseAdmin.from('notifications').insert(recipients.ids.map(id => ({
      recipient_id: id,
      type: 'health_report',
      actor_id: null,
      title: subject,
      body: summary.slice(0, 300),
      link: `/dashboard/monitoring?report=${report.id}`,
    })))
  }

  return NextResponse.json({
    reportId: report.id,
    findings: emailFindings.length,
    suppressedAsRejected,
    closedAsResolved: stale.length,
    emailed: emailRes.success,
    emailError: emailRes.success ? null : emailRes.error,
  })
}
