'use client'

import { useEffect } from 'react'
import { isChunkLoadError, selfHealChunkError } from '@/lib/chunk-error'

// Next.js requires global-error.tsx to render its own <html>/<body> -- it
// replaces the root layout entirely, since it catches errors the root layout
// itself (or anything above app/dashboard/error.tsx) throws.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    if (isChunkLoadError(error)) {
      selfHealChunkError()
    }
  }, [error])

  const chunkError = isChunkLoadError(error)

  return (
    <html lang="en">
      <body style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ maxWidth: 360, textAlign: 'center', padding: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Something went wrong</h2>
          <p style={{ fontSize: 14, color: '#666', marginBottom: 16 }}>
            {chunkError
              ? 'A new version of the app was published while this page was open. Reloading...'
              : 'The app ran into an error. Please reload the page.'}
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid #ccc', background: '#fff', cursor: 'pointer', marginRight: 8 }}
          >
            Reload page
          </button>
          <button
            onClick={() => reset()}
            style={{ padding: '8px 16px', borderRadius: 6, border: 'none', background: '#111', color: '#fff', cursor: 'pointer' }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  )
}
