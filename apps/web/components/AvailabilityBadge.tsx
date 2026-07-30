const LABELS: Record<string, { text: string; className: string }> = {
  in_stock: { text: 'In stock', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  low_stock: { text: 'Only a few left', className: 'bg-amber-50 text-amber-700 border-amber-200' },
  sold_out: { text: 'Sold out', className: 'bg-gray-100 text-gray-500 border-gray-200' },
}

export function AvailabilityBadge({ bucket }: { bucket: string }) {
  const cfg = LABELS[bucket] || LABELS.sold_out
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${cfg.className}`}>
      {cfg.text}
    </span>
  )
}
