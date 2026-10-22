'use client'

import { DialogContent } from '@/components/ui/dialog'
import { useResizableDialogSize } from '@/lib/useResizableDialogSize'
import { cn } from '@/lib/utils'

// A DialogContent that can be drag-resized from its bottom-right corner, for forms
// long/wide enough (quotation/proforma line items) that a fixed max-w/max-h forces
// scrolling even when the user has screen space to spare. Everything but the resize
// handle itself scrolls inside the fixed-size box, so the handle stays reachable.
export function ResizableDialogContent({
  storageKey,
  defaultWidth,
  defaultHeight,
  className,
  children,
}: {
  storageKey: string
  defaultWidth?: number
  defaultHeight?: number
  className?: string
  children: React.ReactNode
}) {
  const { width, height, handleMouseDown } = useResizableDialogSize(storageKey, defaultWidth, defaultHeight)

  return (
    <DialogContent
      className={cn('flex flex-col overflow-hidden', className)}
      style={{ width, height, maxWidth: '95vw', maxHeight: '95vh' }}
    >
      <div className="flex-1 overflow-y-auto min-h-0">{children}</div>
      <div
        onMouseDown={handleMouseDown}
        title="Drag to resize"
        className="absolute bottom-0 right-0 w-5 h-5 cursor-nwse-resize"
      >
        <svg viewBox="0 0 16 16" className="w-full h-full text-muted-foreground/50">
          <path d="M14 2L2 14M14 8L8 14" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        </svg>
      </div>
    </DialogContent>
  )
}
