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

export interface SalesDocumentDefaults {
  next_number: string | null
  is_gst_registered: boolean
  default_notes: string | null
  default_terms: string | null
  // Entity's own state vs. the resolved place of supply -- equal means
  // CGST+SGST, different means IGST (same rule as computeLineGst()).
  entity_state_code: string | null
  place_of_supply: string | null
}

// What the New/Clone form shows before anything is saved: the entity's GST
// status (drives HSN/Tax visibility), its default Notes/T&C, and the number the
// document will *probably* get. The number is a read-only peek at the counter --
// nothing is reserved, so cancelling the form leaves no trace in the database and
// burns no number. The real number is still minted atomically on save via
// next_document_number(); if someone else saves first, this one gets the next.
// Formatting mirrors next_document_number()'s own {prefix}/{fy}/{seq:5} substitution.
// When a customer is given, also resolves the place of supply exactly as the
// POST/PATCH routes do (GSTIN prefix -> customer state_code -> entity's own state),
// so the form's per-line CGST/SGST-vs-IGST split matches what gets saved.
export async function getSalesDocumentDefaults(entityKey: string, docType: SalesDocType, customerId?: string | null): Promise<SalesDocumentDefaults | null> {
  const { data: profile } = await supabaseAdmin
    .from('business_profiles')
    .select('is_gst_registered, state_code, default_notes, default_terms, invoice_number_format, quotation_prefix, proforma_prefix')
    .eq('key', entityKey)
    .maybeSingle()
  if (!profile) return null

  const fy = financialYear()
  const prefix = docType === 'quotation' ? profile.quotation_prefix : profile.proforma_prefix
  let nextNumber: string | null = null
  if (prefix && profile.invoice_number_format) {
    const { data: seq } = await supabaseAdmin
      .from('invoice_sequences')
      .select('last_number')
      .eq('entity_key', entityKey)
      .eq('doc_type', docType)
      .eq('financial_year', fy)
      .maybeSingle()
    nextNumber = String(profile.invoice_number_format)
      .replace('{prefix}', prefix)
      .replace('{fy}', fy.replace('-', '/'))
      .replace('{seq:5}', String((seq?.last_number ?? 0) + 1).padStart(5, '0'))
  }

  let customer: { gst_number: string | null; state_code: string | null } | null = null
  if (customerId) {
    const { data } = await supabaseAdmin.from('customers').select('gst_number, state_code').eq('id', customerId).maybeSingle()
    customer = data
  }
  const placeOfSupply = customer?.gst_number?.trim().slice(0, 2) || customer?.state_code || profile.state_code || null

  return {
    next_number: nextNumber,
    entity_state_code: profile.state_code,
    place_of_supply: placeOfSupply,
    is_gst_registered: !!profile.is_gst_registered,
    default_notes: profile.default_notes,
    default_terms: profile.default_terms,
  }
}

// HSN is mandatory on every line for a GST-registered entity (it prints on the
// PDF's HSN column and carries into the eventual tax invoice); a non-GST entity's
// Bill of Supply has no HSN column, so it isn't asked for there at all.
export function missingHsnError(entity: EntityInfo, items: any[]): string | null {
  if (!entity.is_gst_registered) return null
  const missing = items.findIndex((i) => !String(i.hsn_code || '').trim())
  return missing === -1 ? null : `HSN code is required on every line for a GST-registered entity (line ${missing + 1} has none).`
}
