import { supabaseAdmin } from './supabase/service'

// A unit is only offered in the Sell screen's picker once it has cleared QC.
export const SELLABLE_STATUSES = ['ready_for_sale', 'qc_passed']

// Indian financial year runs April-March, so Jan-Mar belongs to the FY that
// started the previous calendar year -- not the current one.
export function financialYear(date = new Date()): string {
  const year = date.getFullYear()
  const fyStartYear = date.getMonth() >= 3 ? year : year - 1
  const nextYearShort = (fyStartYear + 1) % 100
  return `${fyStartYear}-${String(nextYearShort).padStart(2, '0')}`
}

// Mints the next real invoice number for a business entity via the atomic
// next_document_number() RPC -- never a client-side scan, never editable.
// entityKey maps 1:1 to sales.payment_account (lowercased): 'digitalbluez',
// 'techtenth', or 'cash'.
export async function mintSalesInvoiceNumber(entityKey: string = 'digitalbluez'): Promise<string> {
  const { data, error } = await supabaseAdmin.rpc('next_document_number', {
    p_entity_key: entityKey,
    p_doc_type: 'sales_invoice',
    p_financial_year: financialYear(),
  })
  if (error) throw error
  return data as string
}
