'use client'

import { X } from 'lucide-react'

// Shared lightweight modal -- mx-4 edge gutter + max-h-[85vh] scroll fits any
// viewport, including short mobile screens. Prefer this (or shadcn Dialog with the
// same max-h/overflow pattern) over a one-off `fixed inset-0` overlay, which tends
// to miss both the edge gutter and the height cap.
export function SimpleModal({
  isOpen, onClose, title, children, wide, closeOnBackdropClick = true,
}: {
  isOpen: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean;
  // Set false for forms with fillable data, where an accidental click just
  // outside the dialog shouldn't silently discard everything typed so far --
  // the explicit Cancel/X button is still always available.
  closeOnBackdropClick?: boolean;
}) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={closeOnBackdropClick ? onClose : undefined}>
      <div className={`bg-card rounded-lg ${wide ? 'max-w-2xl' : 'max-w-lg'} w-full mx-4 p-6 max-h-[85vh] overflow-y-auto`} onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-muted-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
