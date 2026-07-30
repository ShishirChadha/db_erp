// Condition grades are owner-authored free text (`sku_master.web_condition_grade`)
// -- map the common conventions to a tone, and fall back to a neutral pill for
// anything else rather than guessing.
function toneFor(grade: string): string {
  const g = grade.trim().toLowerCase();
  if (g.startsWith("a") || g.includes("excellent") || g.includes("like new")) {
    return "border-brand-blue/30 bg-brand-blue/10 text-brand-blue-dark";
  }
  if (g.startsWith("b") || g.includes("good") || g.includes("very good")) {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (g.startsWith("c") || g.includes("fair")) {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  return "border-border bg-secondary text-secondary-foreground";
}

export function ConditionBadge({ grade }: { grade: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${toneFor(grade)}`}
    >
      {grade}
    </span>
  );
}
