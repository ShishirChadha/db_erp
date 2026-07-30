const STEPS = [
  {
    n: "01",
    title: "Inspected",
    detail: "Every unit is quality-checked and graded before it's ever listed.",
    icon: <path d="M9 12.5l2 2 4-4.5M4 6.5l8-3 8 3v5.5c0 5-3.5 8.6-8 10-4.5-1.4-8-5-8-10V6.5z" />,
  },
  {
    n: "02",
    title: "Warrantied",
    detail: "A 6-month warranty and a GST invoice are included with every order.",
    icon: <path d="M12 3l7 3v5.5c0 4.2-3 7.9-7 9-4-1.1-7-4.8-7-9V6l7-3z" />,
  },
  {
    n: "03",
    title: "Delivered",
    detail: "Pay securely with Razorpay, then track your order from your account.",
    icon: (
      <>
        <rect x="2.5" y="7" width="13" height="9" rx="1.2" />
        <path d="M15.5 10h3l3 3v3h-6z" />
        <circle cx="7" cy="18.5" r="1.6" />
        <circle cx="17.5" cy="18.5" r="1.6" />
      </>
    ),
  },
];

export function ProcessSteps() {
  return (
    <div className="stagger grid grid-cols-1 gap-6 sm:grid-cols-3">
      {STEPS.map((s) => (
        <div key={s.n} className="relative rounded-xl border border-border bg-card p-6">
          <span className="font-heading text-xs font-bold text-brand-blue">{s.n}</span>
          <div className="mt-3 flex h-11 w-11 items-center justify-center rounded-full bg-brand-blue/10 text-brand-blue-dark">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
              {s.icon}
            </svg>
          </div>
          <p className="mt-3 font-heading text-base font-bold text-foreground">{s.title}</p>
          <p className="mt-1 text-sm text-muted-foreground">{s.detail}</p>
        </div>
      ))}
    </div>
  );
}
