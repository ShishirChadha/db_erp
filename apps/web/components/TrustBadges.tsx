const BADGES = [
  {
    label: "Quality-checked",
    detail: "Every unit inspected before listing",
    icon: (
      <path d="M9 12.5l2 2 4-4.5M12 3l1.9 1.6 2.5-.2.7 2.4 2.2 1.2-.6 2.5 1.3 2.1-1.7 1.9.4 2.5-2.4.9-1.1 2.3-2.5-.4-2 1.6-2-1.6-2.5.4-1.1-2.3-2.4-.9.4-2.5-1.7-1.9 1.3-2.1-.6-2.5 2.2-1.2.7-2.4 2.5.2z" />
    ),
  },
  {
    label: "6-month warranty",
    detail: "Included on every unit",
    icon: (
      <path d="M12 3l7 3v5.5c0 4.2-3 7.9-7 9-4-1.1-7-4.8-7-9V6l7-3z" />
    ),
  },
  {
    label: "Secure checkout",
    detail: "Payments handled by Razorpay",
    icon: (
      <path d="M4 9h16M6 9V6.5A2.5 2.5 0 018.5 4h7A2.5 2.5 0 0118 6.5V9m-13 0h14a1 1 0 011 1v8a2 2 0 01-2 2H6a2 2 0 01-2-2v-8a1 1 0 011-1z" />
    ),
  },
  {
    label: "GST invoice",
    detail: "Included with every order",
    icon: (
      <path d="M7 3.5h8l3 3V19a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 014 19V5A1.5 1.5 0 015.5 3.5H7zM9 9h6M9 12.5h6M9 16h4" />
    ),
  },
];

export function TrustBadges({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`grid grid-cols-2 gap-x-4 gap-y-5 sm:gap-x-6 ${compact ? "" : "sm:grid-cols-4"}`}>
      {BADGES.map((b) => (
        <div key={b.label} className="flex items-start gap-2.5">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="mt-0.5 h-6 w-6 shrink-0 text-brand-orange"
          >
            {b.icon}
          </svg>
          <div>
            <p className="text-sm font-semibold text-foreground">{b.label}</p>
            <p className="text-xs text-muted-foreground">{b.detail}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
