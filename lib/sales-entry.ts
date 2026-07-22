import { supabaseAdmin } from './supabase/service'

// A unit is only offered in the Sell screen's picker once it has cleared QC.
export const SELLABLE_STATUSES = ['ready_for_sale', 'qc_passed']

export function financialYear(date = new Date()): string {
  const year = date.getFullYear()
  const nextYearShort = (year + 1) % 100
  return `${year}-${nextYearShort}`
}

export async function mintSalesInvoiceNumber(): Promise<string> {
  const { data, error } = await supabaseAdmin.rpc('increment_invoice_number', {
    p_prefix: 'DBIN',
    p_financial_year: financialYear(),
  })
  if (error) throw error
  return data as string
}
