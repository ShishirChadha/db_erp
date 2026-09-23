import { useEffect, useState } from 'react'

/**
 * Tracks whether the viewport currently matches a desktop-width media query.
 * SSR-safe: defaults to `false` (mobile) since `window` doesn't exist on the
 * server, then reconciles on mount and stays live via the media query's
 * `change` event (covers resize/rotate).
 */
export function useIsDesktopViewport(breakpoint = '(min-width: 768px)') {
  const [isDesktop, setIsDesktop] = useState(false)

  useEffect(() => {
    const mql = window.matchMedia(breakpoint)
    setIsDesktop(mql.matches)
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [breakpoint])

  return isDesktop
}
