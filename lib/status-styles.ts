// Single source of truth for "what color is this status" -- previously split three
// ways app-wide (the shared Badge component in 6 files, hand-rolled colored <span>s
// elsewhere, or plain unstyled text). One semantic tone system, one map per domain's
// actual status vocabulary (grounded in the real values each table/column uses).
export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'purple'

export const TONE_CLASSES: Record<Tone, string> = {
  success: 'bg-green-100 text-green-700',
  warning: 'bg-amber-100 text-amber-700',
  danger: 'bg-red-100 text-red-700',
  info: 'bg-blue-100 text-blue-700',
  neutral: 'bg-gray-100 text-gray-600',
  purple: 'bg-purple-100 text-purple-700',
}

export function toneClasses(tone: Tone): string {
  return TONE_CLASSES[tone]
}

// Activity Hub (lib/activities.ts's ACTIVITY_STATUSES / priority enum)
export const ACTIVITY_STATUS_TONES: Record<string, Tone> = {
  pending: 'neutral',
  in_progress: 'info',
  done: 'success',
  cancelled: 'danger',
}
export const ACTIVITY_PRIORITY_TONES: Record<string, Tone> = {
  low: 'neutral',
  normal: 'info',
  high: 'warning',
  urgent: 'danger',
}

// asset_ledger.status (Stock / Live Stock)
export const ASSET_STATUS_TONES: Record<string, Tone> = {
  draft: 'neutral',
  reserved: 'neutral',
  received: 'neutral',
  in_stock: 'neutral',
  qc_pending: 'warning',
  qc_passed: 'info',
  ready_for_sale: 'success',
  sold: 'success',
  faulty: 'danger',
  rma_sent: 'purple',
  rma_returned: 'purple',
  scrapped: 'danger',
}

// repair_jobs.status
export const REPAIR_JOB_STATUS_TONES: Record<string, Tone> = {
  intake: 'neutral',
  in_progress: 'info',
  done: 'success',
  cancelled: 'danger',
}

// sales.payment_status / repair_jobs.payment_status
export const PAYMENT_STATUS_TONES: Record<string, Tone> = {
  pending: 'warning',
  partial: 'info',
  paid: 'success',
}

// sales_documents.status (Quotations/Proformas)
export const SALES_DOCUMENT_STATUS_TONES: Record<string, Tone> = {
  draft: 'neutral',
  sent: 'info',
  accepted: 'success',
  rejected: 'danger',
  expired: 'warning',
  void: 'neutral',
}

// invoices.status
export const INVOICE_STATUS_TONES: Record<string, Tone> = {
  draft: 'neutral',
  pending_approval: 'warning',
  approved: 'info',
  sent: 'info',
  paid: 'success',
  overdue: 'danger',
  void: 'neutral',
}

// purchase_orders.po_status
export const PO_STATUS_TONES: Record<string, Tone> = {
  draft: 'neutral',
  submitted: 'info',
  partially_received: 'warning',
  received: 'success',
  invoiced: 'purple',
  cancelled: 'danger',
}

function fallbackTone(): Tone {
  return 'neutral'
}

/** Looks up a status string in the given map, falling back to a neutral tone for any unmapped value rather than throwing. */
export function toneFor(map: Record<string, Tone>, status: string | null | undefined): Tone {
  if (!status) return fallbackTone()
  return map[status] ?? fallbackTone()
}
