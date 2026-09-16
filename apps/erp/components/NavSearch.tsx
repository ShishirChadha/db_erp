'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import dynamic from 'next/dynamic'

// A plain "jump to any page" search, opened via ⌘K or the sidebar's own
// "Search..." button -- pure page navigation, no Q&A. This used to be shared
// with a since-removed "Ask DB" advisor palette (see docs/decisions.md,
// 2026-09-16); this file is what's left once that's stripped out.
const NavSearchPalette = dynamic(() => import('./NavSearchPalette'), { ssr: false })

const NavSearchContext = createContext<{ open: () => void }>({ open: () => {} })

export function useNavSearch() {
  return useContext(NavSearchContext)
}

export function NavSearchProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const [everOpened, setEverOpened] = useState(false)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  useEffect(() => {
    if (open) setEverOpened(true)
  }, [open])

  return (
    <NavSearchContext.Provider value={{ open: () => setOpen(true) }}>
      {children}
      {everOpened && <NavSearchPalette open={open} onOpenChange={setOpen} />}
    </NavSearchContext.Provider>
  )
}
