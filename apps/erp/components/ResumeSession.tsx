'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

// Shown by app/dashboard/layout.tsx instead of bouncing to /login when:
//   expired     -- the access token ran out (they last 1h) but a refresh token
//                  is still there. The browser client renews it and the same
//                  page reloads, so the user lands where they were going.
//   unavailable -- the server couldn't check the session at all (tunnel blip).
//                  Retry a few times on its own before asking the user.
// A per-tab counter stops a reload loop: if the session still isn't accepted
// after a few attempts, it's genuinely gone and /login is the right answer.
const KEY = 'db_resume_attempts'
const MAX_ATTEMPTS = 3

export function ResumeSession({ mode }: { mode: 'expired' | 'unavailable' }) {
  const [message, setMessage] = useState(mode === 'expired' ? 'Restoring your session…' : 'Reconnecting to the server…')
  const [stuck, setStuck] = useState(false)

  useEffect(() => {
    let attempts = 0
    try { attempts = Number(sessionStorage.getItem(KEY) || '0') } catch { /* private mode */ }
    if (attempts >= MAX_ATTEMPTS) {
      try { sessionStorage.removeItem(KEY) } catch {}
      if (mode === 'expired') { window.location.href = '/login'; return }
      setStuck(true)
      setMessage('Can’t reach the server right now. Check your internet connection and try again.')
      return
    }
    try { sessionStorage.setItem(KEY, String(attempts + 1)) } catch {}

    let cancelled = false
    ;(async () => {
      if (mode === 'expired') {
        // getSession() renews an expired access token from the refresh token
        // and writes the new cookie, which the reload below then sends.
        const { data } = await createClient().auth.getSession()
        if (cancelled) return
        if (!data.session) { window.location.href = '/login'; return }
        window.location.reload()
      } else {
        await new Promise(r => setTimeout(r, 2000 * (attempts + 1)))
        if (!cancelled) window.location.reload()
      }
    })()
    return () => { cancelled = true }
  }, [mode])

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-6">
      <div className="max-w-sm text-center">
        <p className="text-sm text-muted-foreground">{message}</p>
        {stuck && (
          <button
            type="button"
            onClick={() => { try { sessionStorage.removeItem(KEY) } catch {} window.location.reload() }}
            className="mt-4 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted"
          >
            Try again
          </button>
        )}
      </div>
    </div>
  )
}
