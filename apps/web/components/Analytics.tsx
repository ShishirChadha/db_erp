"use client";

import Script from "next/script";
import { useEffect, useState } from "react";

const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
const CONSENT_KEY = "db_cookie_consent";

declare global {
  interface Window {
    dataLayer: unknown[];
    gtag: (...args: unknown[]) => void;
  }
}

// GA4 measurement IDs are "G-" plus 10 alphanumerics. A truncated or mistyped
// ID is silently fatal: gtag.js loads happily, every hit goes to a property
// that does not exist, and the ERP's Reports > Website tab shows an empty
// property forever with no indication of why. That is exactly what happened
// here, so this warns the moment it is wrong in development.
const GA_ID_SHAPE = /^G-[A-Z0-9]{10}$/;

export function Analytics() {
  const [consent, setConsent] = useState<"accepted" | "declined" | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem(CONSENT_KEY);
    if (stored === "accepted" || stored === "declined") setConsent(stored);
  }, []);

  const handleAccept = () => {
    localStorage.setItem(CONSENT_KEY, "accepted");
    setConsent("accepted");
    // MUST be window.gtag -- the global that gtag.js installs from the inline
    // script below, whose body is `dataLayer.push(arguments)`. A local helper
    // doing `dataLayer.push(args)` pushes a real Array instead of an
    // `arguments` object, and gtag.js only interprets arguments-shaped
    // entries, so the consent grant was silently discarded and every visitor
    // stayed in the cookieless/denied state even after clicking Accept. That
    // is why demographics never populated. Do not reintroduce a local shim.
    window.gtag?.("consent", "update", { analytics_storage: "granted", ad_storage: "granted" });
  };

  const handleDecline = () => {
    localStorage.setItem(CONSENT_KEY, "declined");
    setConsent("declined");
  };

  if (!GA_MEASUREMENT_ID) return null;

  if (process.env.NODE_ENV !== "production" && !GA_ID_SHAPE.test(GA_MEASUREMENT_ID)) {
    console.warn(
      `[analytics] NEXT_PUBLIC_GA_MEASUREMENT_ID "${GA_MEASUREMENT_ID}" does not look like a ` +
        `GA4 measurement ID (expected "G-" + 10 alphanumerics). Hits will go nowhere. ` +
        `Check GA4 Admin > Data Streams.`
    );
  }

  return (
    <>
      {/* Default consent state is denied until the visitor accepts -- GA4's
          Consent Mode still records anonymous/modeled traffic counts, but
          never sets ad/analytics cookies or attributes demographics without
          an explicit accept.

          The gtag/js load and the gtag('config') call below are DELIBERATELY
          unconditional, i.e. advanced consent mode: gtag.js keeps sending
          cookieless pings while consent is denied, which is what makes
          traffic counts work at all for visitors who never touch the banner.
          Do not gate them behind `consent === "accepted"` -- that turns this
          into basic consent mode and throws away most of the traffic data. */}
      <Script id="ga-consent-default" strategy="beforeInteractive">
        {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('consent', 'default', { analytics_storage: 'denied', ad_storage: 'denied' });`}
      </Script>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
        strategy="afterInteractive"
      />
      <Script id="ga-init" strategy="afterInteractive">
        {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${GA_MEASUREMENT_ID}');`}
      </Script>

      {consent === null && (
        <div className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background/95 p-4 shadow-[0_-4px_16px_rgba(0,0,0,0.08)] backdrop-blur">
          <div className="mx-auto flex max-w-screen-xl flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              We use cookies to understand site traffic and improve your experience. See our{" "}
              <a href="/privacy" className="underline underline-offset-2 hover:text-foreground">
                Privacy Policy
              </a>
              .
            </p>
            <div className="flex shrink-0 gap-2">
              <button
                onClick={handleDecline}
                className="h-8 rounded-md border border-border px-3 text-sm font-medium hover:bg-muted"
              >
                Decline
              </button>
              <button
                onClick={handleAccept}
                className="h-8 rounded-md bg-foreground px-3 text-sm font-medium text-background hover:opacity-90"
              >
                Accept
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
