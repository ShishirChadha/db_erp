// Owner-only, stateless: parse an uploaded Zoho "Summary of Outward Supplies (GSTR-1)" Excel and
// compare it with what the ERP would file for the same entity/month. Nothing is stored -- the
// file is the user's own check, and re-uploading after a fix just re-runs it. Plain code, no AI.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { compareGstr1, parseZohoGstr1 } from '@/lib/recon/zoho-gstr1-compare'

export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const { entity_key, period_start, period_end, file_b64 } = body as Record<string, string>
  if (!entity_key || !period_start || !period_end || !file_b64) {
    return NextResponse.json({ error: 'entity_key, period_start, period_end and file_b64 are required.' }, { status: 400 })
  }
  if (file_b64.length > 8_000_000) return NextResponse.json({ error: 'File is too large.' }, { status: 413 })

  let zoho
  try { zoho = parseZohoGstr1(Buffer.from(file_b64, 'base64')) }
  catch (e: any) { return NextResponse.json({ error: e?.message || 'Could not read the file.' }, { status: 400 }) }

  const args = { p_entity_key: entity_key, p_from: period_start, p_to: period_end }
  const [sec, hsn, docs, inv] = await Promise.all([
    supabaseAdmin.rpc('gst_r1_sections', args),
    supabaseAdmin.rpc('gst_r1_hsn_summary', args),
    supabaseAdmin.rpc('gst_r1_docs_issued', args),
    supabaseAdmin.from('invoices').select('id, invoice_number, customer_gst, customer_name')
      .eq('entity_key', entity_key).gte('invoice_date', period_start).lte('invoice_date', period_end),
  ])
  // ERP lines behind Table 12, with each item's SKU category and that category's default HSN
  // (Settings → SKU Categories) -- the owner's own lookup, used to suggest the right code.
  const { data: ol } = await supabaseAdmin.from('v_gst_outward_lines')
    .select('line_id, invoice_number, hsn_code, description, is_b2b, txval')
    .eq('entity_key', entity_key).gte('invoice_date', period_start).lte('invoice_date', period_end).not('hsn_code', 'is', null)
  const lineIds = (ol ?? []).map((l: any) => l.line_id)
  const { data: items } = lineIds.length
    ? await supabaseAdmin.from('invoice_items').select('id, sku_id, accessory_id, bundled_into_item_id, sale_id').in('id', lineIds)
    : { data: [] as any[] }
  const skuIds = [...new Set((items ?? []).map((i: any) => i.sku_id || i.accessory_id).filter(Boolean))]
  const [{ data: skus }, { data: tpl }] = await Promise.all([
    skuIds.length ? supabaseAdmin.from('sku_master').select('id, category').in('id', skuIds) : Promise.resolve({ data: [] as any[] }),
    supabaseAdmin.from('sku_category_templates').select('category, default_hsn_code'),
  ])
  // Accessories sold inside a unit's own line (sales.bundled_accessories) have no invoice line of
  // their own; show what the line includes and each one's SKU HSN, since Zoho may bill them apart.
  const saleIds = [...new Set((items ?? []).map((i: any) => i.sale_id).filter(Boolean))]
  const { data: salesB } = saleIds.length
    ? await supabaseAdmin.from('sales').select('id, bundled_accessories').in('id', saleIds)
    : { data: [] as any[] }
  const bundleAccIds = [...new Set((salesB ?? []).flatMap((x: any) => (Array.isArray(x.bundled_accessories) ? x.bundled_accessories : []).map((b: any) => b.accessory_id)).filter(Boolean))]
  const { data: bundleSkus } = bundleAccIds.length
    ? await supabaseAdmin.from('sku_master').select('id, sku_description, hsn_code').in('id', bundleAccIds)
    : { data: [] as any[] }
  const accById = new Map((bundleSkus ?? []).map((k: any) => [k.id, k]))
  const inlineBySale = new Map((salesB ?? []).map((x: any) => [x.id, (Array.isArray(x.bundled_accessories) ? x.bundled_accessories : []).map((b: any) => {
    const a: any = accById.get(b.accessory_id)
    return { accessory_id: b.accessory_id as string, item: String(a?.sku_description ?? 'Accessory').replace(/\s+/g, ' ').trim(), hsn: (a?.hsn_code as string | null) || null, qty: Number(b.quantity ?? 1) }
  })]))
  const saleByItem = new Map((items ?? []).map((i: any) => [i.id, i.sale_id as string | null]))
  const skuCat = new Map((skus ?? []).map((k: any) => [k.id, k.category as string]))
  const ruleByCat = new Map((tpl ?? []).map((t: any) => [t.category, (t.default_hsn_code as string | null) || null]))
  const itemById = new Map((items ?? []).map((i: any) => [i.id, i.sku_id || i.accessory_id]))
  const bundledById = new Map((items ?? []).map((i: any) => [i.id, (i.bundled_into_item_id as string | null) ?? null]))
  const erpLines = (ol ?? []).map((l: any) => {
    const cat = skuCat.get(itemById.get(l.line_id) as string) ?? null
    return { line_id: l.line_id as string, invoice_number: l.invoice_number, hsn: String(l.hsn_code), is_b2b: !!l.is_b2b, item: String(l.description ?? '').split('\n')[0].slice(0, 40), taxable: Number(l.txval), category: cat, rule: cat ? ruleByCat.get(cat) ?? null : null, bundled_into: bundledById.get(l.line_id) ?? null, inline: inlineBySale.get(saleByItem.get(l.line_id) as string) ?? [] }
  })
  const err = sec.error || hsn.error || docs.error || inv.error
  if (err) return NextResponse.json({ error: err.message }, { status: 500 })

  // Zoho's own item lines (with HSN) from the latest step-1 invoice CSV for this month, if it was
  // read after the matcher began keeping them. Without them the comparison falls back to code totals.
  const { data: zImp } = await supabaseAdmin.from('gst_recon_imports').select('id')
    .eq('entity_key', entity_key).eq('kind', 'zoho_invoices').eq('period_start', period_start)
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  let zohoLines: Map<string, any[]> | null = null
  if (zImp) {
    const { data: zl } = await supabaseAdmin.from('gst_recon_lines').select('doc_number, raw').eq('import_id', zImp.id)
    const m = new Map<string, any[]>()
    for (const l of zl ?? []) {
      const lines = (l as any).raw?.lines
      if (l.doc_number && Array.isArray(lines) && lines.some((x: any) => x?.hsn)) m.set(l.doc_number, lines)
    }
    zohoLines = m.size ? m : null
  }

  const byNumber = new Map((inv.data ?? []).map((i: any) => [i.invoice_number, { id: i.id, customer_gst: i.customer_gst, customer_name: i.customer_name }]))
  const result = compareGstr1(zoho, sec.data, hsn.data, docs.data, byNumber, erpLines, zohoLines)
  return NextResponse.json({
    ...result,
    hsn_invoices: result.hsn_invoices.map((h) => ({ ...h, invoice_id: byNumber.get(h.invoice_number)?.id ?? null })),
    issues: result.issues.map((i) => ({
      ...i,
      invoice_id: i.invoice_number ? byNumber.get(i.invoice_number)?.id ?? null : null,
      invoices: i.invoices?.map((v) => ({ ...v, invoice_id: byNumber.get(v.number)?.id ?? null })),
    })),
  })
}
