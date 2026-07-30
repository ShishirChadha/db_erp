'use client'

import { useEffect, useState } from 'react'

// `url` is computed server-side (same SITE_URL convention as layout.tsx) and
// passed in as a prop -- never derived from window.location here, and
// navigator.share support is checked post-mount, not during render. Doing
// either at render time would render differently on the server than the
// client and produce a hydration mismatch.
export function ShareButtons({ url, title }: { url: string; title: string }) {
  const [canShare, setCanShare] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    setCanShare(typeof navigator !== 'undefined' && typeof navigator.share === 'function')
  }, [])

  const handleNativeShare = async () => {
    try {
      await navigator.share({ title, url })
    } catch {
      // user cancelled -- not an error
    }
  }

  const handleCopy = async () => {
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const iconClass = 'flex h-8 w-8 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:border-brand-orange hover:text-brand-orange'

  return (
    <div className="flex items-center gap-2">
      <a
        href={`https://wa.me/?text=${encodeURIComponent(`${title} — ${url}`)}`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Share on WhatsApp"
        className={iconClass}
      >
        <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
          <path d="M12.01 2C6.48 2 2 6.48 2 12.01c0 1.77.46 3.45 1.27 4.9L2 22l5.24-1.37a9.96 9.96 0 004.77 1.22h.01c5.53 0 10.01-4.48 10.01-10.01C22 6.48 17.54 2 12.01 2z" />
        </svg>
      </a>
      <a
        href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Share on Facebook"
        className={iconClass}
      >
        <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
          <path d="M14 8.5h2V5h-2a4 4 0 00-4 4v2H8.5v3.5H10V21h3.5v-6.5H16l.5-3.5h-3V9a.5.5 0 01.5-.5z" />
        </svg>
      </a>
      <a
        href={`https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(title)}`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Share on X"
        className={iconClass}
      >
        <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
          <path d="M18.9 2.5h3.1l-6.8 7.8L23.3 21.5h-6.3l-4.9-6.4-5.6 6.4H3.4l7.3-8.3L2.7 2.5H9.2l4.4 5.9zm-1.1 17h1.7L7.2 4.4H5.4z" />
        </svg>
      </a>
      {canShare ? (
        <button type="button" onClick={handleNativeShare} aria-label="Share" className={iconClass}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
            <circle cx="18" cy="5" r="2.5" />
            <circle cx="6" cy="12" r="2.5" />
            <circle cx="18" cy="19" r="2.5" />
            <path d="M8.2 10.8l7.6-4.1M8.2 13.2l7.6 4.1" />
          </svg>
        </button>
      ) : (
        <button type="button" onClick={handleCopy} aria-label="Copy link" className={iconClass}>
          {copied ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
              <path d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
              <rect x="9" y="9" width="11" height="11" rx="2" />
              <path d="M5 15V6a1 1 0 011-1h9" />
            </svg>
          )}
        </button>
      )}
    </div>
  )
}
