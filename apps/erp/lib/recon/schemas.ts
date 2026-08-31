import { z } from 'zod'

// Structured shape the extraction pipeline (Tier 1 template rules and Tier 2 AI)
// both normalize into, regardless of source. Shared by vendor-invoice recon
// (Phase 4/5) and bank-statement recon (Phase 6) via doc_kind-specific schemas.

export const VendorInvoiceLineSchema = z.object({
  description: z.string(),
  hsn_code: z.string().nullable().optional(),
  quantity: z.number(),
  rate: z.number(),
  gst_rate: z.number().nullable().optional(),
  amount: z.number(),
  serial_numbers: z.array(z.string()).optional(),
})

export const VendorInvoiceExtractionSchema = z.object({
  vendor_name: z.string().describe('The vendor/seller name as printed on the invoice'),
  vendor_gstin: z.string().nullable().optional().describe('15-character GSTIN if present'),
  vendor_address: z.string().nullable().optional(),
  vendor_city: z.string().nullable().optional().describe('City only, not the full address line'),
  vendor_pincode: z.string().nullable().optional().describe('6-digit postal PIN code only'),
  vendor_state: z.string().nullable().optional(),
  vendor_phone: z.string().nullable().optional().describe('Primary phone/mobile number as printed'),
  vendor_phone_2: z.string().nullable().optional().describe('A second phone/mobile number, if the invoice prints more than one (e.g. office + mobile) -- null if only one is printed'),
  vendor_email: z.string().nullable().optional(),
  invoice_number: z.string(),
  invoice_date: z.string().describe('ISO date YYYY-MM-DD'),
  subtotal: z.number().describe('Sum of line amounts before GST'),
  total_gst: z.number(),
  grand_total: z.number().describe('Final invoice total, what the vendor is billing'),
  lines: z.array(VendorInvoiceLineSchema),
})
export type VendorInvoiceExtraction = z.infer<typeof VendorInvoiceExtractionSchema>

export const BankTransactionRowSchema = z.object({
  txn_date: z.string().describe('ISO date YYYY-MM-DD'),
  value_date: z.string().nullable().optional(),
  narration: z.string(),
  reference: z.string().nullable().optional(),
  debit: z.number().nullable().optional(),
  credit: z.number().nullable().optional(),
  running_balance: z.number().nullable().optional(),
})

export const BankStatementExtractionSchema = z.object({
  account_number_last4: z.string().nullable().optional(),
  period_start: z.string().describe('ISO date YYYY-MM-DD'),
  period_end: z.string().describe('ISO date YYYY-MM-DD'),
  opening_balance: z.number().nullable().optional(),
  closing_balance: z.number().nullable().optional(),
  transactions: z.array(BankTransactionRowSchema),
})
export type BankStatementExtraction = z.infer<typeof BankStatementExtractionSchema>
