// Email for the daily health & speed report (System Health -> Daily reports).
// Plain inline-styled HTML tables, same approach as lib/digests/render.ts, so it
// renders in every client the owner might open it in.
export interface OpsEmailFinding {
  severity: 'act' | 'watch' | 'info'
  area: string
  title: string
  evidence: string | null
  suggestion: string | null
  fix_kind: string
  status: string
  isNew: boolean
}

const ERP_URL = 'https://erp.digitalbluez.com'

const SEVERITY: Record<OpsEmailFinding['severity'], { label: string; color: string; bg: string }> = {
  act: { label: 'Act', color: '#b91c1c', bg: '#fee2e2' },
  watch: { label: 'Watch', color: '#a16207', bg: '#fef3c7' },
  info: { label: 'Info', color: '#1d4ed8', bg: '#dbeafe' },
}

const OVERALL: Record<string, { label: string; color: string }> = {
  healthy: { label: 'Healthy', color: '#15803d' },
  watch: { label: 'Needs watching', color: '#a16207' },
  act: { label: 'Needs action', color: '#b91c1c' },
}

function esc(s: string | null | undefined): string {
  return (s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>')
}

export function renderOpsHealthEmail(input: {
  reportId: string
  reportDate: string
  overall: string
  summary: string
  findings: OpsEmailFinding[]
}): { subject: string; html: string } {
  const o = OVERALL[input.overall] ?? OVERALL.watch
  const link = `${ERP_URL}/dashboard/monitoring?report=${input.reportId}`
  const counts = {
    act: input.findings.filter(f => f.severity === 'act').length,
    watch: input.findings.filter(f => f.severity === 'watch').length,
  }
  const subject = input.overall === 'healthy'
    ? `Health report ${input.reportDate}: all healthy`
    : `Health report ${input.reportDate}: ${counts.act ? `${counts.act} to act on` : ''}${counts.act && counts.watch ? ', ' : ''}${counts.watch ? `${counts.watch} to watch` : ''}`

  const findingsHtml = input.findings.length === 0
    ? '<p style="color:#6b7280;font-size:14px;">Nothing needs your attention today.</p>'
    : input.findings.map(f => {
        const sev = SEVERITY[f.severity] ?? SEVERITY.info
        return `<table style="width:100%;border-collapse:collapse;margin:0 0 12px;border:1px solid #e5e7eb;border-left:3px solid ${sev.color};border-radius:4px;">
          <tr><td style="padding:12px 14px;">
            <span style="display:inline-block;background:${sev.bg};color:${sev.color};font-size:11px;font-weight:700;padding:2px 6px;border-radius:3px;text-transform:uppercase;">${sev.label}</span>
            <span style="color:#6b7280;font-size:12px;margin-left:6px;">${esc(f.area)} · ${esc(f.fix_kind)} fix${f.isNew ? ' · <strong style="color:#111827;">new</strong>' : ''}</span>
            <div style="font-size:15px;font-weight:600;color:#111827;margin:6px 0 4px;">${esc(f.title)}</div>
            ${f.evidence ? `<div style="font-size:13px;color:#374151;margin:4px 0;"><strong>Evidence:</strong> ${esc(f.evidence)}</div>` : ''}
            ${f.suggestion ? `<div style="font-size:13px;color:#374151;margin:4px 0;"><strong>Suggestion:</strong> ${esc(f.suggestion)}</div>` : ''}
          </td></tr>
        </table>`
      }).join('')

  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;max-width:640px;margin:0 auto;color:#111827;">
    <h2 style="font-size:18px;margin:0 0 4px;">Daily health &amp; speed report — ${esc(input.reportDate)}</h2>
    <div style="font-size:14px;font-weight:600;color:${o.color};margin:0 0 12px;">${o.label}</div>
    <p style="font-size:14px;color:#374151;line-height:1.5;margin:0 0 16px;">${esc(input.summary)}</p>
    ${findingsHtml}
    <p style="margin:20px 0;">
      <a href="${link}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 16px;border-radius:6px;">Review &amp; approve fixes</a>
    </p>
    <p style="font-size:12px;color:#9ca3af;line-height:1.5;">
      Nothing changes until you approve a finding. Approved code fixes are prepared as a GitHub pull request at 10am / 3pm IST; merging the PR is what deploys it.
      Database and server fixes are marked "needs you" because they can only be applied from a local session.
    </p>
  </div>`

  return { subject, html }
}
