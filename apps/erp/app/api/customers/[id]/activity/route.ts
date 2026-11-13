import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, hasPageAccess } from '@/lib/auth/session'

// Everything that references one customer, for the Customers page detail pane:
// sales (with their invoice numbers), invoices, and counts of the other linked
// records -- so a duplicate/junk customer can be told apart from a real one
// before it's deleted. Service-role read (so an employee's RLS view can't make
// a customer look unused), selecting only selling-side columns: no cost,
// vendor or margin field is fetched.
const LIST_LIMIT = 500

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPageAccess(sessionUser, 'customers')) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const count = (table: string) =>
    supabaseAdmin.from(table).select('id', { count: 'exact', head: true }).eq('customer_id', id)

  const [sales, voidedSales, invoices, repairJobs, replacementJobs, accessoryJobs, quotations, rentals] = await Promise.all([
    supabaseAdmin
      .from('sales')
      .select('id, sale_date, invoice_number, invoice_id, asset_number, asset_description, serial_number, sku, sale_total, al:asset_ledger_id(sku:sku_id(sku_description)), acc:accessory_id(sku_description, full_sku_code), rj:repair_job_id(job_number), ra:rental_agreement_id(agreement_number)', { count: 'exact' })
      .eq('customer_id', id)
      .eq('is_deleted', false)
      .order('sale_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(LIST_LIMIT),
    count('sales').eq('is_deleted', true),
    supabaseAdmin
      .from('invoices')
      .select('id, invoice_number, invoice_date, invoice_type, status, grand_total', { count: 'exact' })
      .eq('customer_id', id)
      .or('is_deleted.is.null,is_deleted.eq.false')
      .order('invoice_date', { ascending: false })
      .limit(LIST_LIMIT),
    count('repair_jobs'),
    count('replacement_jobs'),
    count('accessory_replacement_jobs'),
    count('sales_documents'),
    count('rental_agreements'),
  ])
  const failed = [sales, voidedSales, invoices, repairJobs, replacementJobs, accessoryJobs, quotations, rentals].find((r) => r.error)
  if (failed?.error) return NextResponse.json({ error: failed.error.message }, { status: 500 })

  // A sale can carry an invoice number without an ERP invoice row (recorded
  // Zoho invoices), so the distinct invoice numbers come from both sources.
  const invoiceNumbers = new Set<string>()
  for (const inv of invoices.data || []) if (inv.invoice_number) invoiceNumbers.add(inv.invoice_number)
  for (const s of sales.data || []) if (s.invoice_number) invoiceNumbers.add(s.invoice_number)

  return NextResponse.json({
    sales: {
      count: sales.count ?? 0,
      voided: voidedSales.count ?? 0,
      list: (sales.data || []).map((s: any) => ({
        id: s.id,
        sale_date: s.sale_date,
        invoice_number: s.invoice_number,
        invoice_id: s.invoice_id,
        // Same description sources as the Sales Ledger: unit snapshot, else the
        // accessory's SKU, else the repair job / rental agreement it bills.
        item: [
          s.asset_number,
          s.asset_description || s.al?.sku?.sku_description || s.acc?.sku_description || s.acc?.full_sku_code || s.sku
            || (s.rj?.job_number && `Repair job ${s.rj.job_number}`)
            || (s.ra?.agreement_number && `Rental ${s.ra.agreement_number}`),
          s.serial_number && `SN ${s.serial_number}`,
        ].map((p) => (p ? String(p).replace(/\s+/g, ' ').trim() : p)).filter(Boolean).join(' · ') || null,
        sale_total: s.sale_total,
      })),
    },
    invoices: {
      count: invoiceNumbers.size,
      list: invoices.data || [],
    },
    other: {
      repair_jobs: repairJobs.count ?? 0,
      replacement_jobs: (replacementJobs.count ?? 0) + (accessoryJobs.count ?? 0),
      quotations: quotations.count ?? 0,
      rentals: rentals.count ?? 0,
    },
  })
}
