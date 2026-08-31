// One DigestPayload -> three renderers. Never re-derives a metric -- only formats
// what build.ts already assembled from the report_* RPCs, and only the blocks the
// recipient actually selected (payload.blocks, already role-sanitized by build.ts).
//
// Charts are plain HTML tables with colored <td> widths, not <img>/SVG/canvas --
// email clients (Outlook desktop in particular) strip external images by default
// and don't render inline SVG/canvas at all. A table-cell "bar" renders correctly
// everywhere a digest might be opened, at the cost of true circular donuts -- the
// "donut" ask is instead a segmented horizontal bar (share of each category as a
// proportional colored strip), which degrades gracefully to a plain legend list on
// clients that don't respect inline background-color.
import type { DigestPayload } from './build'

const CHART_COLORS = ['#2563eb', '#16a34a', '#ea580c', '#9333ea', '#db2777', '#0891b2', '#65a30d', '#dc2626']

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  return `Rs ${Math.round(n).toLocaleString('en-IN')}`
}
function fmtHtml(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  return `₹${Math.round(n).toLocaleString('en-IN')}`
}

function row(label: string, value: string): string {
  return `<tr>
    <td style="padding:6px 0;color:#6b7280;font-size:14px;">${label}</td>
    <td style="padding:6px 0;text-align:right;font-weight:600;color:#111827;font-size:14px;">${value}</td>
  </tr>`
}

function sectionTitle(title: string): string {
  return `<h3 style="color:#111827;font-size:14px;margin:20px 0 8px;border-top:1px solid #e5e7eb;padding-top:16px;">${title}</h3>`
}

// A row-per-bar "chart": label, a proportional colored strip, formatted value.
// `rows` must already be sorted/limited by the caller (report_breakdown does both).
function horizontalBarChart(rows: Array<{ label: string; value: number }>, formatValue: (n: number) => string): string {
  if (!rows.length) return '<p style="color:#9ca3af;font-size:13px;">No data for this period.</p>'
  const max = Math.max(...rows.map((r) => r.value), 1)
  return `<table style="width:100%;border-collapse:collapse;">
    ${rows.map((r, i) => {
      const pct = Math.max(2, Math.round((r.value / max) * 100))
      const color = CHART_COLORS[i % CHART_COLORS.length]
      return `<tr>
        <td style="padding:4px 0;font-size:12px;color:#374151;width:34%;">${r.label}</td>
        <td style="padding:4px 0;width:46%;">
          <table style="width:100%;border-collapse:collapse;"><tr>
            <td style="background:${color};width:${pct}%;height:10px;border-radius:3px;font-size:0;line-height:0;">&nbsp;</td>
            <td style="width:${100 - pct}%;font-size:0;line-height:0;">&nbsp;</td>
          </tr></table>
        </td>
        <td style="padding:4px 0 4px 8px;text-align:right;font-size:12px;color:#111827;font-weight:600;white-space:nowrap;">${formatValue(r.value)}</td>
      </tr>`
    }).join('')}
  </table>`
}

// A single proportional strip split into colored segments (the "donut" stand-in --
// see file header) plus a text legend with each share's percentage.
function segmentedBarChart(rows: Array<{ label: string; value: number }>): string {
  if (!rows.length) return '<p style="color:#9ca3af;font-size:13px;">No data for this period.</p>'
  const total = rows.reduce((s, r) => s + r.value, 0) || 1
  const segments = rows.map((r, i) => ({ ...r, pct: Math.round((r.value / total) * 100), color: CHART_COLORS[i % CHART_COLORS.length] }))
  return `
    <table style="width:100%;border-collapse:collapse;"><tr>
      ${segments.map((s) => `<td style="background:${s.color};width:${s.pct}%;height:16px;font-size:0;line-height:0;">&nbsp;</td>`).join('')}
    </tr></table>
    <table style="width:100%;border-collapse:collapse;margin-top:6px;">
      ${segments.map((s) => `<tr>
        <td style="padding:2px 0;font-size:12px;color:#374151;"><span style="color:${s.color};">●</span> ${s.label}</td>
        <td style="padding:2px 0;text-align:right;font-size:12px;color:#111827;">${s.pct}%</td>
      </tr>`).join('')}
    </table>`
}

export function renderDigestEmail(p: DigestPayload): { subject: string; html: string } {
  const cur = p.kpis?.current
  const inv = p.inventory?.units
  const has = (id: string) => p.blocks.includes(id)
  const subject = `${p.periodLabel} — ${fmtHtml(cur?.revenue_incl)} revenue`

  let body = ''

  if (has('kpis') && cur) {
    const rows: string[] = []
    rows.push(row('Revenue', fmtHtml(cur.revenue_incl)))
    rows.push(row('Units Sold', String(cur.units ?? '—')))
    rows.push(row('Collections', fmtHtml(cur.collections)))
    rows.push(row('Outstanding', fmtHtml(cur.outstanding)))
    if (p.kpis?.revenue_growth_pct !== undefined && p.kpis?.revenue_growth_pct !== null) {
      rows.push(row('Revenue vs prior period', `${p.kpis.revenue_growth_pct > 0 ? '+' : ''}${p.kpis.revenue_growth_pct}%`))
    }
    body += `<table style="width:100%;border-collapse:collapse;">${rows.join('')}</table>`
  }

  if (has('trend') && p.timeseries && p.timeseries.length > 0) {
    body += sectionTitle('Revenue Trend')
    body += horizontalBarChart(
      p.timeseries.map((t: any) => ({ label: new Date(t.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }), value: t.revenue_incl || 0 })),
      fmtHtml
    )
  }

  if (has('margin') && cur && 'gross_margin_known' in cur) {
    body += sectionTitle('Margin')
    body += `<table style="width:100%;border-collapse:collapse;">
      ${row('Gross Margin (costed units)', fmtHtml(cur.gross_margin_known))}
      ${row('Cost Coverage', `${cur.cost_coverage_pct ?? '—'}% of unit sales`)}
    </table>`
  }

  if (has('category_breakdown') && p.categoryBreakdown && p.categoryBreakdown.length > 0) {
    body += sectionTitle('Revenue by Category')
    body += horizontalBarChart(p.categoryBreakdown.map((r: any) => ({ label: r.label, value: r.revenue_incl || 0 })), fmtHtml)
  }

  if (has('staff_breakdown') && p.staffBreakdown && p.staffBreakdown.length > 0) {
    body += sectionTitle('Revenue by Staff')
    body += horizontalBarChart(p.staffBreakdown.map((r: any) => ({ label: r.label, value: r.revenue_incl || 0 })), fmtHtml)
  }

  if (has('sale_type_split') && p.saleTypeSplit && p.saleTypeSplit.length > 0) {
    body += sectionTitle('GST vs Cash Split')
    body += segmentedBarChart(p.saleTypeSplit.map((r: any) => ({ label: r.label, value: r.units || 0 })))
  }

  if (has('purchasing') && p.vendorBreakdown && p.vendorBreakdown.length > 0) {
    body += sectionTitle('Vendor Spend')
    body += horizontalBarChart(p.vendorBreakdown.map((r: any) => ({ label: r.label, value: r.spend || 0 })), fmtHtml)
  }

  if (has('inventory') && inv) {
    body += sectionTitle('Stock')
    body += `<table style="width:100%;border-collapse:collapse;">
      ${row('Sellable Stock', String(inv.sellable_count))}
      ${row('QC Pending', String(inv.qc_pending_count))}
      ${row('On Hand', String(inv.on_hand_count))}
    </table>`
  }

  if (has('receivables') && p.receivables?.by_bucket) {
    body += sectionTitle('Receivables Ageing')
    body += horizontalBarChart(p.receivables.by_bucket.map((b: any) => ({ label: b.bucket, value: b.outstanding || 0 })), fmtHtml)
  }

  if (has('data_health') && p.dataHealth) {
    const flagged = Object.entries(p.dataHealth).filter(([, v]) => (v as number) > 0)
    if (flagged.length > 0) {
      body += `<div style="margin-top:16px;padding:10px 12px;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;font-size:12px;color:#92400e;">
        Data health: ${flagged.map(([k, v]) => `${k.replace(/_/g, ' ')} (${v})`).join(', ')}
      </div>`
    }
  }

  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;">
      <h2 style="color:#111827;margin-bottom:4px;">${p.periodLabel}</h2>
      <p style="color:#6b7280;font-size:13px;margin-top:0;">${p.from} to ${p.to}</p>
      ${body}
      <p style="color:#9ca3af;font-size:12px;margin-top:24px;">
        Automated digest from the ERP reporting layer. Full detail in Dashboard → Reports.
        <br/>Customize which sections appear here in Settings → Digests.
      </p>
    </div>`
  return { subject, html }
}

// Positional params for an approved WhatsApp template. Design the template with a
// body like:
//   "{{1}}\nRevenue: {{2}} | Units: {{3}}\nCollections: {{4}}\nOutstanding: {{5}}"
// and this must stay in that same order. WhatsApp templates are plain text with no
// chart support -- charts are an email/in-app-only feature (see renderDigestEmail).
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
