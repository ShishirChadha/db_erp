import { supabaseAdmin } from './supabase/service'
import { financialYear } from './sales-entry'

export type SalesDocType = 'quotation' | 'proforma'

// Mints the next quotation/proforma number atomically, same RPC and
// never-editable/never-reused guarantee as sales invoice numbering.
export async function mintSalesDocumentNumber(entityKey: string, docType: SalesDocType): Promise<string> {
  const { data, error } = await supabaseAdmin.rpc('next_document_number', {
    p_entity_key: entityKey,
    p_doc_type: docType,
    p_financial_year: financialYear(),
  })
  if (error) throw error
  return data as string
}

export interface EntityInfo {
  is_gst_registered: boolean
  state_code: string | null
}

// A quotation/PI line has no pre-existing sale to derive its GST amount
// from (unlike an invoice line, which reflects an already-completed sale) --
// this computes it fresh from quantity*rate*gst_rate, using the same
// state-code intra/inter-state classification as the real invoicing engine,
// so a converted line's estimate lines up with what the eventual sale will
// actually charge.
export function computeLineGst(entity: EntityInfo, placeOfSupplyStateCode: string | null, lineAmount: number, gstRatePercent: number) {
  const isIntraState = !!entity.state_code && entity.state_code === placeOfSupplyStateCode
  const gstAmount = entity.is_gst_registered ? Math.round(lineAmount * gstRatePercent * 100) / 10000 : 0
  const cgstAmount = entity.is_gst_registered && isIntraState ? gstAmount / 2 : 0
  const sgstAmount = entity.is_gst_registered && isIntraState ? gstAmount / 2 : 0
  const igstAmount = entity.is_gst_registered && !isIntraState ? gstAmount : 0
  const gstType = !entity.is_gst_registered ? null : isIntraState ? 'CGST_SGST' : 'IGST'
  return { gstType, cgstAmount, sgstAmount, igstAmount, gstAmount, amount: lineAmount + gstAmount }
}
