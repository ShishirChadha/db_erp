'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { Sparkles } from 'lucide-react'

// Mounted once in app/dashboard/layout.tsx. AdvisorPalette (cmdk + the fetch logic)
// is lazy-loaded only on first open (ssr:false requires living inside a Client
// Component -- see node_modules/next/dist/docs/.../lazy-loading.md) so this adds
// ~0 to the initial dashboard bundle, per the performance contract in
// docs/decisions.md (2026-08-29): DB must never make the ERP itself feel slower.
const AdvisorPalette = dynamic(() => import('./AdvisorPalette'), { ssr: false })

// Shared open-state, provided once at the dashboard layout level (wraps both
// <Sidebar> and <AdvisorLauncher>) so the sidebar's own "Search ⌘K" button (a
// discoverability affordance for people who don't know the shortcut exists)
// opens the exact same dialog instance as the global ⌘K listener below.
const NavPaletteContext = createContext<{ open: () => void }>({ open: () => {} })

export function useNavPalette() {
  return useContext(NavPaletteContext)
}

export function NavPaletteProvider({ children }: { children: React.ReactNode }) {
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
    <NavPaletteContext.Provider value={{ open: () => setOpen(true) }}>
      {children}
      {everOpened && <AdvisorPalette open={open} onOpenChange={setOpen} />}
    </NavPaletteContext.Provider>
  )
}

export default function AdvisorLauncher() {
  const { open } = useNavPalette()

  return (
    <button
      type="button"
      onClick={open}
      className="fixed bottom-4 left-4 z-40 flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-lg hover:bg-primary/90 md:bottom-6 md:left-6"
      aria-label="Ask DB"
    >
      <Sparkles className="h-4 w-4" />
      <span className="hidden sm:inline">Ask DB</span>
      <kbd className="hidden rounded bg-primary-foreground/20 px-1.5 py-0.5 text-xs md:inline">⌘K</kbd>
    </button>
  )
}
