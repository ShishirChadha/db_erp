'use client'

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

// Shared inline PDF preview -- takes an already-fetched blob URL (caller owns the
// fetch/loading state via useAsyncAction, same as the existing Download PDF button)
// and renders it in an iframe instead of opening a new browser tab, so a document
// can be visually checked (logo/QR/signature placement, layout) without leaving the page.
//
// Revoking the blob URL is the caller's job (in its onClose), not this component's --
// React Strict Mode mounts effects twice in dev (mount -> cleanup -> mount again), so a
// revoke tied to this component's own effect fires after the first simulated mount and
// kills the URL before the iframe ever finishes loading it, which is exactly what
// produces Chrome's "It may have been moved, edited or deleted" PDF-viewer error.
export default function PdfPreviewDialog({ url, title, onClose }: { url: string; title: string; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-4xl h-[90vh] flex flex-col">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <iframe src={url} title={title} className="flex-1 w-full rounded border" />
      </DialogContent>
    </Dialog>
  )
}
