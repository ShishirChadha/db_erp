'use client'

import { useEffect, useRef, useState } from 'react'

// Lets a free-text field (Notes, Terms & Conditions, etc.) remember its value
// across new documents -- opt-in via a checkbox, persisted to localStorage per
// `storageKey`. Prefills on mount if the field starts empty and a saved
// default exists; while the checkbox stays checked, every edit is written
// straight back to localStorage so the next document picks it up too.
//
// `storageKey` may change after mount (e.g. a per-entity key like
// `salesdoc-notes-default-${entityKey}` when the Entity dropdown is switched)
// -- when it does, this swaps in the new key's saved default, but only if the
// field still holds exactly what was prefilled for the previous key (or is
// empty), so switching Entity never clobbers text the user actually typed.
export function useRememberedDefault(storageKey: string, value: string, setValue: (v: string) => void) {
  const [remember, setRemember] = useState(false)
  const mountedRef = useRef(false)
  const prevSavedRef = useRef<string | null>(null)

  useEffect(() => {
    let saved: string | null = null
    try {
      saved = window.localStorage.getItem(storageKey)
    } catch {
      /* ignore */
    }

    if (!mountedRef.current) {
      mountedRef.current = true
      if (saved && !value) {
        setValue(saved)
        setRemember(true)
      }
    } else {
      const matchesPreviousDefault = value === '' || value === prevSavedRef.current
      if (matchesPreviousDefault) {
        setValue(saved || '')
        setRemember(!!saved)
      }
    }
    prevSavedRef.current = saved
    // Re-runs only when storageKey itself changes -- `value`/`setValue` are
    // deliberately excluded so this isn't a continuous sync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey])

  useEffect(() => {
    if (!remember) return
    try {
      window.localStorage.setItem(storageKey, value)
    } catch {
      /* ignore */
    }
  }, [remember, value, storageKey])

  const toggle = (checked: boolean) => {
    setRemember(checked)
    try {
      if (checked) window.localStorage.setItem(storageKey, value)
      else window.localStorage.removeItem(storageKey)
    } catch {
      /* ignore */
    }
  }

  return { remember, toggle }
}
