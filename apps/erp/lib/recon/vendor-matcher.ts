import { supabaseAdmin } from '@/lib/supabase/service'
import { stateCodeFromGstin, stateNameFromCode } from '@db/shared'
import type { VendorInvoiceExtraction } from './schemas'

// Vendor identity resolution + field comparison for Phase 4 (see docs/decisions.md,
// "vendor reconciliation"). Two independent jobs: figure out *which* vendor an
// invoice is from, then compare the invoice's header fields against that vendor's
// record and propose only genuine fills/conflicts -- never a blank-out.

export interface VendorRow {
  id: string
  company_name: string
  gst_company_name: string | null
  gst_number: string | null
  has_gst: boolean
  address_line1: string | null
  address_line2: string | null
  city: string | null
  state: string | null
  pincode: string | null
  phone: string | null
  alt_phone: string | null
  email: string | null
}

export interface VendorMatchResult {
  vendor: VendorRow | null
  matchMethod: 'gstin' | 'name_trigram' | 'template' | 'none'
  candidates?: { id: string; company_name: string; similarity: number }[]
}

// GSTIN format: 2-digit state code, 10-char PAN, 1 entity code, 'Z' literal, 1 checksum.
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/

export function isValidGstin(gstin: string | null | undefined): boolean {
  return !!gstin && GSTIN_RE.test(gstin.trim().toUpperCase())
}

// Order: GSTIN exact match (decisive -- a GSTIN uniquely identifies a legal entity)
// -> company-name trigram match (best-guess, returned as candidates for the owner to
// confirm rather than auto-selected) -> a template's already-known vendor_id, if the
// caller has one from Tier 1. No match at all -> caller offers "create vendor".
export async function resolveVendor(
  extraction: VendorInvoiceExtraction,
  templateVendorId?: string | null
): Promise<VendorMatchResult> {
  const gstin = extraction.vendor_gstin?.trim().toUpperCase()
  if (isValidGstin(gstin)) {
    const { data } = await supabaseAdmin
      .from('vendors')
      .select('*')
      .eq('gst_number', gstin)
      .eq('is_deleted', false)
      .maybeSingle()
    if (data) return { vendor: data as VendorRow, matchMethod: 'gstin' }
  }

  if (templateVendorId) {
    const { data } = await supabaseAdmin.from('vendors').select('*').eq('id', templateVendorId).eq('is_deleted', false).maybeSingle()
    if (data) return { vendor: data as VendorRow, matchMethod: 'template' }
  }

  if (extraction.vendor_name?.trim()) {
    const { data: candidates } = await supabaseAdmin.rpc('match_vendors_by_name', {
      p_name: extraction.vendor_name.trim(),
      p_limit: 5,
    })
    if (candidates && candidates.length > 0) {
      // A strong single hit (>0.6 trigram similarity, matching the conservativeness of
      // isLikelyDuplicateText elsewhere in this codebase) auto-selects; anything weaker
      // is surfaced as candidates for the owner to pick from rather than guessed.
      if (candidates[0].similarity >= 0.6 && (candidates.length === 1 || candidates[0].similarity - candidates[1].similarity > 0.15)) {
        const { data: vendor } = await supabaseAdmin.from('vendors').select('*').eq('id', candidates[0].id).single()
        if (vendor) return { vendor: vendor as VendorRow, matchMethod: 'name_trigram', candidates }
      }
      return { vendor: null, matchMethod: 'none', candidates }
    }
  }

  return { vendor: null, matchMethod: 'none' }
}

export interface ProposedCorrection {
  field_name: string
  current_value: string | null
  proposed_value: string | null
  change_kind: 'fill_missing' | 'conflict' | 'derived'
  confidence: 'high' | 'medium' | 'low'
}

function isEmpty(v: string | null | undefined): boolean {
  return v === null || v === undefined || v.trim() === ''
}

// 'phone' is deliberately not in this list -- an invoice can print two numbers, so it
// gets its own dual-number handling below rather than the generic single-value diff.
const COMPARED_FIELDS = ['gst_number', 'gst_company_name', 'company_name', 'address_line1', 'address_line2', 'city', 'state', 'pincode', 'email'] as const

// Builds the field-by-field diff. Hard rule, non-negotiable: a field the invoice
// doesn't carry (blank/absent) never proposes anything, even if the vendor record has
// a value -- an invoice's silence is not evidence the existing value is wrong.
export function buildCorrectionProposals(vendor: VendorRow, extraction: VendorInvoiceExtraction): ProposedCorrection[] {
  const proposals: ProposedCorrection[] = []

  const invoiceValues: Partial<Record<(typeof COMPARED_FIELDS)[number], string | null | undefined>> = {
    gst_number: extraction.vendor_gstin,
    gst_company_name: extraction.vendor_name, // the invoice's own letterhead name is the closest analog to gst_company_name
    company_name: undefined, // never propose overwriting the ERP's own working company_name from an invoice guess
    address_line1: extraction.vendor_address,
    city: extraction.vendor_city,
    state: extraction.vendor_state,
    pincode: extraction.vendor_pincode,
    email: extraction.vendor_email,
  }

  for (const field of COMPARED_FIELDS) {
    const invoiceValue = invoiceValues[field]
    if (isEmpty(invoiceValue)) continue // invoice doesn't carry this field -- no proposal, per the hard rule above

    const currentValue = (vendor as any)[field] as string | null
    const trimmedInvoice = invoiceValue!.trim()

    if (isEmpty(currentValue)) {
      // fill_missing is inherently the safe case -- the field was empty, so there is
      // zero risk of overwriting a real existing value, and any bad fill is trivially
      // reversible via the same field_corrections-backed revert route as everything
      // else here. High confidence across every field is what makes "Approve all
      // safe fills" actually useful rather than a button that only ever fires on
      // GSTIN.
      proposals.push({ field_name: field, current_value: currentValue, proposed_value: trimmedInvoice, change_kind: 'fill_missing', confidence: 'high' })
    } else if (currentValue!.trim().toLowerCase() !== trimmedInvoice.toLowerCase()) {
      proposals.push({ field_name: field, current_value: currentValue, proposed_value: trimmedInvoice, change_kind: 'conflict', confidence: 'medium' })
    }
  }

  // Phone: an invoice can print two numbers (office + mobile). The primary and
  // secondary invoice numbers are handled independently (not as an interchangeable
  // pool) so that, say, an already-correct `phone` plus a newly-seen second number
  // proposes only an alt_phone fill -- never a spurious "conflict" on the primary
  // number just because the *second* number happens to be the one that's new.
  const knownPhones = [vendor.phone, vendor.alt_phone]
    .filter((p): p is string => !isEmpty(p))
    .map((p) => p.trim().toLowerCase())
  const primaryInvoicePhone = !isEmpty(extraction.vendor_phone) ? extraction.vendor_phone!.trim() : null
  const secondaryInvoicePhone = !isEmpty(extraction.vendor_phone_2) ? extraction.vendor_phone_2!.trim() : null

  if (primaryInvoicePhone && !knownPhones.includes(primaryInvoicePhone.toLowerCase())) {
    if (isEmpty(vendor.phone)) {
      proposals.push({ field_name: 'phone', current_value: vendor.phone, proposed_value: primaryInvoicePhone, change_kind: 'fill_missing', confidence: 'high' })
    } else {
      proposals.push({ field_name: 'phone', current_value: vendor.phone, proposed_value: primaryInvoicePhone, change_kind: 'conflict', confidence: 'medium' })
    }
  }

  if (
    secondaryInvoicePhone &&
    secondaryInvoicePhone.toLowerCase() !== (primaryInvoicePhone || '').toLowerCase() &&
    !knownPhones.includes(secondaryInvoicePhone.toLowerCase()) &&
    isEmpty(vendor.alt_phone)
  ) {
    proposals.push({ field_name: 'alt_phone', current_value: vendor.alt_phone, proposed_value: secondaryInvoicePhone, change_kind: 'fill_missing', confidence: 'high' })
  }

  // has_gst is derived from GSTIN presence, never transcribed from the invoice
  // directly -- a valid GSTIN on the invoice means this vendor is GST-registered,
  // regardless of what the invoice's own layout happens to print anywhere else.
  if (isValidGstin(extraction.vendor_gstin) && vendor.has_gst !== true) {
    proposals.push({ field_name: 'has_gst', current_value: String(vendor.has_gst), proposed_value: 'true', change_kind: 'derived', confidence: 'high' })
  }

  return proposals
}

export interface GstinStateCrossCheck {
  ok: boolean
  gstinStateCode: string | null
  gstinStateName: string | null
  vendorState: string | null
}

// A vendor's stored `state` contradicting their own GSTIN's state code means the
// vendor's tax treatment (CGST+SGST vs IGST) is being computed wrong right now --
// this is the highest-value single check in vendor recon, called out separately from
// the generic field-diff loop above so the UI can flag it distinctly.
export function crossCheckGstinState(vendor: VendorRow, extraction: VendorInvoiceExtraction): GstinStateCrossCheck | null {
  if (!isValidGstin(extraction.vendor_gstin)) return null
  const code = stateCodeFromGstin(extraction.vendor_gstin)
  const name = stateNameFromCode(code)
  const vendorState = vendor.state?.trim() || null
  if (!vendorState) return null // no existing value to contradict -- the fill_missing proposal above already covers this case
  return {
    ok: name != null && vendorState.toLowerCase() === name.toLowerCase(),
    gstinStateCode: code,
    gstinStateName: name,
    vendorState,
  }
}
