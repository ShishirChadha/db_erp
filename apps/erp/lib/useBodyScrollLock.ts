'use client'

import { useEffect } from 'react'

// Locks background scroll while a modal is open -- without this, the page
// behind a fixed-position dialog keeps scrolling on touch (mobile browsers
// don't treat a fixed overlay as a scroll boundary the way desktop does), and
// the on-screen keyboard can push a bottom-anchored dialog off-screen. Counts
// nested/concurrent locks via a shared counter so two modals opening at once
// (or one opening while another is still closing) don't fight over restoring
// the original overflow value too early.
let lockCount = 0
let previousOverflow = ''

export function useBodyScrollLock(locked: boolean) {
  useEffect(() => {
    if (!locked) return
    if (lockCount === 0) {
      previousOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
    }
    lockCount++
    return () => {
      lockCount--
      if (lockCount === 0) {
        document.body.style.overflow = previousOverflow
      }
    }
  }, [locked])
}
