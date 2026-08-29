// One DigestPayload -> three renderers. Never re-derives a metric -- only formats
// what build.ts already assembled from the report_* RPCs.
import type { DigestPayload } from './build'

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  return `Rs ${Math.round(n).toLocaleString('en-IN')}`
}
function fmtHtml(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  return `₹${Math.round(n).toLocaleString('en-IN')}`
}

export function renderDigestEmail(p: DigestPayload): { subject: string; html: string } {
  const cur = p.kpis?.current
  const inv = p.inventory?.units
  const subject = `${p.periodLabel} — ${fmtHtml(cur?.revenue_incl)} revenue`

  const rows: string[] = []
  rows.push(row('Revenue', fmtHtml(cur?.revenue_incl)))
  rows.push(row('Units Sold', String(cur?.units ?? '—')))
  rows.push(row('Collections', fmtHtml(cur?.collections)))
  rows.push(row('Outstanding', fmtHtml(cur?.outstanding)))
  if (p.kpis?.revenue_growth_pct !== undefined && p.kpis?.revenue_growth_pct !== null) {
    rows.push(row('Revenue vs prior period', `${p.kpis.revenue_growth_pct > 0 ? '+' : ''}${p.kpis.revenue_growth_pct}%`))
  }
  if (cur && 'gross_margin_known' in cur) {
    rows.push(row('Gross Margin (costed units)', fmtHtml(cur.gross_margin_known)))
    rows.push(row('Cost Coverage', `${cur.cost_coverage_pct ?? '—'}% of unit sales`))
  }
  if (inv) {
    rows.push(row('Sellable Stock', String(inv.sellable_count)))
    rows.push(row('QC Pending', String(inv.qc_pending_count)))
  }
  if (p.receivables?.by_bucket) {
    const overdue = p.receivables.by_bucket.filter((b: any) => b.bucket !== '0-15').reduce((s: number, b: any) => s + b.outstanding, 0)
    rows.push(row('Receivables 15+ days', fmtHtml(overdue)))
  }

  let healthBlock = ''
  if (p.dataHealth) {
    const flagged = Object.entries(p.dataHealth).filter(([, v]) => (v as number) > 0)
    if (flagged.length > 0) {
      healthBlock = `
        <tr><td colspan="2" style="padding-top:16px;font-size:13px;color:#92400e;">
          Data health: ${flagged.map(([k, v]) => `${k.replace(/_/g, ' ')} (${v})`).join(', ')}
        </td></tr>`
    }
  }

  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;">
      <h2 style="color:#111827;">${p.periodLabel}</h2>
      <p style="color:#6b7280;font-size:13px;">${p.from} to ${p.to}</p>
      <table style="width:100%;border-collapse:collapse;">
        ${rows.join('')}
        ${healthBlock}
      </table>
      <p style="color:#9ca3af;font-size:12px;margin-top:24px;">
        Automated digest from the ERP reporting layer. Full detail in Dashboard → Reports.
      </p>
    </div>`
  return { subject, html }
}

function row(label: string, value: string): string {
  return `<tr>
    <td style="padding:6px 0;color:#6b7280;font-size:14px;">${label}</td>
    <td style="padding:6px 0;text-align:right;font-weight:600;color:#111827;font-size:14px;">${value}</td>
  </tr>`
}

// Positional params for an approved WhatsApp template. Design the template with a
// body like:
//   "{{1}}\nRevenue: {{2}} | Units: {{3}}\nCollections: {{4}}\nOutstanding: {{5}}"
// and this must stay in that same order.
export function renderWhatsAppParams(p: DigestPayload): string[] {
  const cur = p.kpis?.current
  return [
    p.periodLabel,
    fmt(cur?.revenue_incl),
    String(cur?.units ?? 0),
    fmt(cur?.collections),
    fmt(cur?.outstanding),
  ]
}

export function renderInAppBody(p: DigestPayload): { title: string; body: string } {
  const cur = p.kpis?.current
  return {
    title: `${p.periodLabel} digest`,
    body: `Revenue ${fmt(cur?.revenue_incl)} · ${cur?.units ?? 0} units · Collections ${fmt(cur?.collections)} · Outstanding ${fmt(cur?.outstanding)}`,
  }
}
