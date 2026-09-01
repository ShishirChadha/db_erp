'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { apiFetch } from '@/lib/api-client'
import { useRole } from '@/lib/auth/useRole'

export const THEMES = ['slate', 'ocean', 'forest', 'amber', 'midnight'] as const
export type ThemeName = typeof THEMES[number]

const STORAGE_KEY = 'db-erp-theme'
const DEFAULT_THEME: ThemeName = 'slate'

function isThemeName(value: unknown): value is ThemeName {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value)
}

function applyTheme(theme: ThemeName) {
  if (theme === DEFAULT_THEME) {
    document.documentElement.removeAttribute('data-theme')
  } else {
    document.documentElement.setAttribute('data-theme', theme)
  }
}

interface ThemeContextValue {
  theme: ThemeName
  setTheme: (theme: ThemeName, opts?: { persist?: boolean }) => void
}

const ThemeContext = createContext<ThemeContextValue>({ theme: DEFAULT_THEME, setTheme: () => {} })

export function useTheme() {
  return useContext(ThemeContext)
}

// Applies the theme instantly from localStorage (a blocking inline script in
// layout.tsx's <head> already did this before hydration, to avoid a flash of
// the wrong theme -- this just keeps React's state in sync with the DOM
// attribute it set). Once a server-stored preference is known (useRole's
// uiPreferences, read by whichever page/component calls setTheme with the
// server value), that value takes over and is persisted back to localStorage
// too so logged-out/instant paint stays correct on the next visit.
export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeName>(DEFAULT_THEME)
  const { loading, uiPreferences } = useRole()
  const reconciledRef = useRef(false)

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (isThemeName(stored)) setThemeState(stored)
  }, [])

  // Once the server-known preference loads, it wins over whatever localStorage
  // had (e.g. a different theme picked on another device) -- but only once per
  // mount, so it never fights a theme the user just picked in this same session.
  useEffect(() => {
    if (loading || reconciledRef.current) return
    reconciledRef.current = true
    const serverTheme = uiPreferences?.theme
    if (isThemeName(serverTheme) && serverTheme !== theme) {
      setThemeState(serverTheme)
      applyTheme(serverTheme)
      localStorage.setItem(STORAGE_KEY, serverTheme)
    }
  }, [loading, uiPreferences, theme])

  const setTheme = useCallback((next: ThemeName, opts?: { persist?: boolean }) => {
    setThemeState(next)
    applyTheme(next)
    localStorage.setItem(STORAGE_KEY, next)
    if (opts?.persist) {
      apiFetch('/api/profile/preferences', { method: 'PATCH', body: JSON.stringify({ theme: next }) }).catch(() => {})
    }
  }, [])

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>
}
