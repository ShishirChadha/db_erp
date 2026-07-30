'use client'

import { useCallback, useRef, useState } from 'react'

// Wraps an async click/submit handler so a second click while the first is still
// in flight is a no-op instead of firing a duplicate request -- this is what
// actually stops double-entry (a confirm dialog doesn't: the real submit still
// only ever needs to be triggered once). Pair `pending` with a disabled state and
// a spinner on the button so the user gets instant feedback that the click
// registered, without adding an extra step to the flow.
export function useAsyncAction<Args extends unknown[]>(
  action: (...args: Args) => Promise<unknown>
) {
  const [pending, setPending] = useState(false)
  const pendingRef = useRef(false)

  const run = useCallback(
    async (...args: Args) => {
      if (pendingRef.current) return
      pendingRef.current = true
      setPending(true)
      try {
        await action(...args)
      } finally {
        pendingRef.current = false
        setPending(false)
      }
    },
    [action]
  )

  return { run, pending }
}
