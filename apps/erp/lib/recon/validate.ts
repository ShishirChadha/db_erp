import type { VendorInvoiceExtraction, BankStatementExtraction } from './schemas'

// The non-negotiable rule for this pipeline (see docs/decisions.md): the model
// transcribes, code does the arithmetic. Never accept a total the model reports --
// re-derive it from the line items and compare. A mismatch means either the
// extraction misread a number or the source document itself has an error; either
// way it goes to needs_review, never a silent accept, on both the Tier 1 (regex)
// and Tier 2 (AI) paths equally -- this function doesn't know or care which tier
// produced its input.

const ROUNDING_TOLERANCE = 0.5 // paise-level rounding, not a real discrepancy

export interface ValidationIssue {
  field: string
  expected: number
  extracted: number
  delta: number
}

export interface ValidationResult {
  ok: boolean
  issues: ValidationIssue[]
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/[,₹\s]/g, ''))
  return Number.isFinite(n) ? n : 0
}

export function validateVendorInvoiceExtraction(ext: VendorInvoiceExtraction): ValidationResult {
  const issues: ValidationIssue[] = []

  // A real invoice always has at least one line. Without this check, a Tier 1
  // template that fails to extract any line items (its field_rules never learned
  // a line-item pattern -- see lib/recon/pdf-text.ts) produces lines=[] with every
  // total defaulting to 0, and every arithmetic check below then trivially
  // "matches" (0 == 0) -- silently marking a completely failed extraction as
  // 'parsed' instead of flagging it for the owner to re-read with AI.
  if (ext.lines.length === 0) {
    issues.push({ field: 'lines', expected: 1, extracted: 0, delta: 1 })
  }

  const derivedSubtotal = ext.lines.reduce((sum, l) => sum + num(l.quantity) * num(l.rate), 0)
  if (Math.abs(derivedSubtotal - num(ext.subtotal)) > ROUNDING_TOLERANCE) {
    issues.push({ field: 'subtotal', expected: derivedSubtotal, extracted: num(ext.subtotal), delta: derivedSubtotal - num(ext.subtotal) })
  }

  const derivedLineTotal = ext.lines.reduce((sum, l) => sum + num(l.amount), 0)
  const derivedGrandFromLines = derivedLineTotal
  // Lines' own `amount` should sum to subtotal+GST (grand_total) when the source
  // prints line-level tax-inclusive amounts, or to subtotal alone otherwise --
  // accept either reading rather than guessing which convention this vendor uses.
  const matchesGrand = Math.abs(derivedGrandFromLines - num(ext.grand_total)) <= ROUNDING_TOLERANCE
  const matchesSubtotal = Math.abs(derivedGrandFromLines - num(ext.subtotal)) <= ROUNDING_TOLERANCE
  if (!matchesGrand && !matchesSubtotal) {
    issues.push({ field: 'line_amounts_sum', expected: derivedGrandFromLines, extracted: num(ext.grand_total), delta: derivedGrandFromLines - num(ext.grand_total) })
  }

  const derivedGrand = num(ext.subtotal) + num(ext.total_gst)
  if (Math.abs(derivedGrand - num(ext.grand_total)) > ROUNDING_TOLERANCE) {
    issues.push({ field: 'grand_total', expected: derivedGrand, extracted: num(ext.grand_total), delta: derivedGrand - num(ext.grand_total) })
  }

  return { ok: issues.length === 0, issues }
}

export function validateBankStatementExtraction(ext: BankStatementExtraction): ValidationResult {
  const issues: ValidationIssue[] = []

  if (ext.opening_balance != null && ext.closing_balance != null) {
    const net = ext.transactions.reduce((sum, t) => sum + num(t.credit) - num(t.debit), 0)
    const derivedClosing = num(ext.opening_balance) + net
    if (Math.abs(derivedClosing - num(ext.closing_balance)) > ROUNDING_TOLERANCE) {
      issues.push({ field: 'closing_balance', expected: derivedClosing, extracted: num(ext.closing_balance), delta: derivedClosing - num(ext.closing_balance) })
    }
  }

  // Running-balance chain check where the statement prints one -- catches a
  // dropped row that the opening/closing check alone can miss (a mid-statement
  // omission can still net to the right total by coincidence).
  let prevBalance: number | null = null
  for (let i = 0; i < ext.transactions.length; i++) {
    const t = ext.transactions[i]
    if (t.running_balance == null) continue
    if (prevBalance != null) {
      const expected = prevBalance + num(t.credit) - num(t.debit)
      if (Math.abs(expected - num(t.running_balance)) > ROUNDING_TOLERANCE) {
        issues.push({ field: `running_balance[${i}]`, expected, extracted: num(t.running_balance), delta: expected - num(t.running_balance) })
      }
    }
    prevBalance = num(t.running_balance)
  }

  return { ok: issues.length === 0, issues }
}
