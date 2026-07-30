'use client'

import { Loader2 } from 'lucide-react'

export interface ReviewRow {
  label: string
  value: React.ReactNode
}

// A read-only "does this look right?" step shown before a form actually submits --
// reduces the risk of a wrong entry going in (wrong price, wrong customer, etc.)
// without adding another confirm() popup. Confirm re-triggers the form's own
// (already useAsyncAction-guarded) submit handler; this dialog doesn't duplicate
// that guard, just delays the click that fires it by one screen.
export function ReviewSummaryDialog({
  title,
  rows,
  onBack,
  onConfirm,
  confirming,
  confirmLabel = 'Confirm & Submit',
}: {
  title: string
  rows: ReviewRow[]
  onBack: () => void
  onConfirm: () => void
  confirming: boolean
  confirmLabel?: string
}) {
  const visibleRows = rows.filter((r) => r.value !== '' && r.value !== null && r.value !== undefined)

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-lg max-w-lg w-full max-h-[85vh] overflow-y-auto p-6">
        <h2 className="text-lg font-bold mb-1">{title}</h2>
        <p className="text-sm text-gray-500 mb-4">Please review before submitting -- you can still go back and edit.</p>
        <dl className="divide-y">
          {visibleRows.map((r) => (
            <div key={r.label} className="py-2 flex justify-between gap-4 text-sm">
              <dt className="text-gray-500">{r.label}</dt>
              <dd className="font-medium text-right">{r.value}</dd>
            </div>
          ))}
        </dl>
        <div className="flex justify-end gap-2 mt-4">
          <button type="button" onClick={onBack} disabled={confirming} className="px-4 py-2 border rounded disabled:opacity-50">
            Back to Edit
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={confirming}
            className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {confirming && <Loader2 className="size-4 animate-spin" />}
            {confirming ? 'Submitting...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
