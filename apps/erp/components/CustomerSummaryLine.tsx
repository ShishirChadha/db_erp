import type { CustomerSummary } from "@/lib/customer-summary";

// Small "who is this" subtitle shown under a customer name -- see lib/customer-summary.ts
// for why this exists (disambiguating same-named customers without opening the profile).
export function CustomerSummaryLine({ summary, className }: { summary: CustomerSummary | null | undefined; className?: string }) {
  if (!summary) return null;
  const parts: string[] = [];
  if (summary.type) parts.push(summary.type);
  if (summary.contact_person) parts.push(`Contact: ${summary.contact_person}`);
  if (summary.address) parts.push(summary.address);
  if (summary.source) parts.push(`Source: ${summary.source}`);
  if (parts.length === 0) return null;
  return <div className={className || "text-xs text-muted-foreground"}>{parts.join(" · ")}</div>;
}
