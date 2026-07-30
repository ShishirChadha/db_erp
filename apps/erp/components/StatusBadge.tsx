import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { Tone, toneClasses } from "@/lib/status-styles"

// Shared status/priority pill -- wraps the existing shadcn Badge with a semantic
// tone (see lib/status-styles.ts) instead of every page hand-rolling its own
// colored <span> or leaving status as plain unstyled text.
export function StatusBadge({
  tone,
  children,
  className,
}: {
  tone: Tone
  children: React.ReactNode
  className?: string
}) {
  return (
    <Badge variant="outline" className={cn("border-transparent capitalize", toneClasses(tone), className)}>
      {children}
    </Badge>
  )
}
