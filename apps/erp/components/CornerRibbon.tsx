import { cn } from "@/lib/utils"
import type { Tone } from "@/lib/status-styles"

// Solid-fill versions of the tone tokens StatusBadge already uses (its own
// pills are a translucent /15 tint, which reads fine as a small badge but
// washes out at ribbon size/contrast) -- same semantic tones, just the solid
// bg-*/its own -foreground pairing for a banner that needs to read at a
// glance from across the room, the way Zoho's "Paid" ribbon does.
const RIBBON_CLASSES: Record<Tone, string> = {
  success: "bg-success text-success-foreground",
  warning: "bg-warning text-warning-foreground",
  danger: "bg-destructive text-destructive-foreground",
  info: "bg-info text-info-foreground",
  neutral: "bg-muted-foreground text-background",
  purple: "bg-purple text-purple-foreground",
}

// Diagonal folded-corner banner across a document's top-left corner (e.g.
// "Paid" on an invoice), matching Zoho Books' own ribbon treatment. Purely
// decorative -- never the only place a status is shown (the page's own
// StatusBadge/toolbar still carries that), so this degrades safely if ever
// clipped by print/PDF layout.
export function CornerRibbon({ label, tone, className }: { label: string; tone: Tone; className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute -left-11 top-6 w-40 -rotate-45 py-1 text-center text-xs font-bold uppercase tracking-wide shadow-md",
        RIBBON_CLASSES[tone],
        className
      )}
    >
      {label}
    </div>
  )
}
