'use client'

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { Sparkles } from 'lucide-react'

// Mounted once in app/dashboard/layout.tsx. AdvisorPalette (cmdk + the fetch logic)
// is lazy-loaded only on first open (ssr:false requires living inside a Client
// Component -- see node_modules/next/dist/docs/.../lazy-loading.md) so this adds
// ~0 to the initial dashboard bundle, per the performance contract in
// docs/decisions.md (2026-08-29): DB must never make the ERP itself feel slower.
const AdvisorPalette = dynamic(() => import('./AdvisorPalette'), { ssr: false })

export default function AdvisorLauncher() {
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
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-lg hover:bg-blue-700 md:bottom-6 md:right-6"
        aria-label="Ask DB"
      >
        <Sparkles className="h-4 w-4" />
        <span className="hidden sm:inline">Ask DB</span>
        <kbd className="hidden rounded bg-blue-700/60 px-1.5 py-0.5 text-xs md:inline">⌘K</kbd>
      </button>
      {everOpened && <AdvisorPalette open={open} onOpenChange={setOpen} />}
    </>
  )
}
